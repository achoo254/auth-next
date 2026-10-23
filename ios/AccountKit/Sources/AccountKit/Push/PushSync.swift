import Foundation
import Observation

/// Keeps the IdP's push registration in step with this phone: the token
/// is bound to the grant of the access token, so it is sent again after a
/// re-authentication switched grants, and removed before sign-out.
@MainActor
@Observable
public final class PushSync {
    public static let enabledKey = "push.enabled"

    /// The person turned security notifications on in the app.
    public private(set) var isEnabled: Bool
    public private(set) var lastError: AccountError?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let environment: APNsEnvironment
    @ObservationIgnored private let locale: String
    @ObservationIgnored private var api: AccountAPI?
    @ObservationIgnored private var deviceToken: Data?

    public init(defaults: UserDefaults = .standard, environment: APNsEnvironment, locale: String) {
        self.defaults = defaults
        self.environment = environment
        self.locale = locale
        isEnabled = defaults.bool(forKey: Self.enabledKey)
    }

    /// Signed in: the API to register with. Signed out: nil.
    public func attach(_ api: AccountAPI?) {
        self.api = api
    }

    public func setEnabled(_ enabled: Bool) async {
        isEnabled = enabled
        defaults.set(enabled, forKey: Self.enabledKey)
        if enabled {
            await register()
        } else {
            await unregister()
        }
    }

    /// From `didRegisterForRemoteNotificationsWithDeviceToken`.
    public func deviceTokenReceived(_ token: Data) async {
        deviceToken = token
        await register()
    }

    /// Sends the current token, if there is one and push is on.
    public func register() async {
        guard isEnabled, let api, let deviceToken else { return }
        do {
            try await api.registerPushDevice(
                PushDeviceRegistration(deviceToken: deviceToken, environment: environment, locale: locale)
            )
            lastError = nil
        } catch {
            lastError = AccountError.wrap(error)
        }
    }

    /// Best effort before sign-out: the IdP also drops the row when the
    /// grant dies, so a failure here leaves nothing that can still be used.
    public func unregister() async {
        guard let api else { return }
        try? await api.deletePushDevice()
    }

    /// Sign-out or deletion: the next account starts with push off.
    public func reset() {
        isEnabled = false
        lastError = nil
        api = nil
        defaults.removeObject(forKey: Self.enabledKey)
    }
}
