import Foundation
import LocalAuthentication
import Observation

/// Face ID / Touch ID with the device passcode as fallback.
public protocol DeviceOwnerAuthenticating: Sendable {
    /// The device has a passcode, so the policy can be evaluated.
    func canAuthenticate() -> Bool
    func authenticate(reason: String) async -> Bool
}

/// `.deviceOwnerAuthentication` rather than biometrics only, so a failing
/// Face ID never locks the owner out. A new `LAContext` per attempt.
public struct LocalDeviceOwnerAuthenticator: DeviceOwnerAuthenticating {
    public init() {}

    public func canAuthenticate() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    public func authenticate(reason: String) async -> Bool {
        do {
            return try await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}

/// The optional app lock (off by default) and the privacy cover. The cover
/// hides account details whenever the app is not active, including the
/// app switcher snapshot; the lock asks for Face ID when the app returns
/// after more than `gracePeriod` in the background, and at launch.
///
/// The lock is a UI gate only: tokens stay readable in the Keychain so
/// refresh and push handling keep working (see TokenStore).
@MainActor
@Observable
public final class AppLock {
    public static let enabledKey = "appLock.enabled"
    public static let gracePeriod: TimeInterval = 30

    public private(set) var isEnabled: Bool
    public private(set) var isLocked: Bool
    public private(set) var isCovered = false
    public private(set) var isAuthenticating = false

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let authenticator: any DeviceOwnerAuthenticating
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var backgroundedAt: Date?

    public init(
        defaults: UserDefaults = .standard,
        authenticator: any DeviceOwnerAuthenticating = LocalDeviceOwnerAuthenticator(),
        now: @escaping () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.authenticator = authenticator
        self.now = now
        let enabled = defaults.bool(forKey: Self.enabledKey)
        isEnabled = enabled
        isLocked = enabled
    }

    public var isAvailable: Bool { authenticator.canAuthenticate() }

    /// Scene left `.active` (inactive or background): cover the content.
    public func sceneResignedActive() {
        isCovered = true
    }

    public func sceneEnteredBackground() {
        isCovered = true
        if backgroundedAt == nil { backgroundedAt = now() }
    }

    public func sceneBecameActive() {
        // The Face ID sheet itself makes the scene inactive; ignore that.
        if isAuthenticating { return }
        if let backgroundedAt, isEnabled, now().timeIntervalSince(backgroundedAt) > Self.gracePeriod {
            isLocked = true
        }
        backgroundedAt = nil
        isCovered = false
    }

    public func unlock(reason: String) async {
        guard isLocked, !isAuthenticating else { return }
        isAuthenticating = true
        let success = await authenticator.authenticate(reason: reason)
        isAuthenticating = false
        if success { isLocked = false }
    }

    /// Turning the lock on needs a successful authentication first, so
    /// nobody locks a phone they cannot unlock. Turning it off needs one
    /// too: otherwise the toggle is a way around the lock.
    @discardableResult
    public func setEnabled(_ enabled: Bool, reason: String) async -> Bool {
        guard enabled != isEnabled else { return true }
        guard authenticator.canAuthenticate() else { return false }
        isAuthenticating = true
        let success = await authenticator.authenticate(reason: reason)
        isAuthenticating = false
        guard success else { return false }
        isEnabled = enabled
        defaults.set(enabled, forKey: Self.enabledKey)
        return true
    }

    /// After sign-out or deletion the next person starts unlocked and off.
    public func reset() {
        isEnabled = false
        isLocked = false
        defaults.removeObject(forKey: Self.enabledKey)
    }
}
