import Foundation
import Observation

/// Why the sign-in screen is showing.
public enum SignedOutReason: Equatable, Sendable {
    /// The IdP ended the session (revoked from the web, 90-day cap...).
    case sessionExpired
    case accountDeleted
}

/// Top of the app: signed in or not, sign-in and sign-out, and the
/// re-authentication every sensitive action goes through.
@MainActor
@Observable
public final class AppModel {
    public enum Phase: Equatable, Sendable {
        case launching
        case signedOut(SignedOutReason?)
        case signedIn
    }

    public private(set) var phase: Phase = .launching
    public private(set) var account: AccountStore?
    public private(set) var isSigningIn = false
    public var signInError: AccountError?
    /// Set when a notification is tapped; the overview navigates to it.
    public var pendingDestination: AccountDestination?

    public let config: AccountConfig
    public let push: PushSync
    public let lock: AppLock
    @ObservationIgnored private let auth: AuthService
    @ObservationIgnored private let refresher: TokenRefresher
    @ObservationIgnored private let api: AccountAPI
    @ObservationIgnored private let web: any WebAuthenticating

    public init(
        config: AccountConfig,
        auth: AuthService,
        refresher: TokenRefresher,
        api: AccountAPI,
        web: any WebAuthenticating,
        push: PushSync,
        lock: AppLock
    ) {
        self.config = config
        self.auth = auth
        self.refresher = refresher
        self.api = api
        self.web = web
        self.push = push
        self.lock = lock
    }

    /// Wires the kit together for a build: Keychain, URLSession, the IdP.
    public static func live(
        config: AccountConfig,
        web: any WebAuthenticating,
        secureStore: any SecureStore,
        http: any HTTPClient,
        deviceName: String?,
        locale: String,
        pushEnvironment: APNsEnvironment,
        defaults: UserDefaults = .standard
    ) -> AppModel {
        let discovery = DiscoveryCache(config: config, http: http)
        let oidc = OIDCClient(config: config, http: http, discovery: discovery)
        let refresher = TokenRefresher(store: TokenStore(secure: secureStore), oidc: oidc)
        let auth = AuthService(
            config: config, oidc: oidc, refresher: refresher, deviceName: deviceName, uiLocale: locale
        )
        return AppModel(
            config: config,
            auth: auth,
            refresher: refresher,
            api: AccountAPI(config: config, http: http, tokens: refresher),
            web: web,
            push: PushSync(defaults: defaults, environment: pushEnvironment, locale: locale),
            lock: AppLock(defaults: defaults)
        )
    }

    public func start() async {
        await refresher.onSessionEnded { [weak self] in
            await self?.sessionEnded()
        }
        if await auth.isSignedIn {
            enterSignedIn()
        } else {
            phase = .signedOut(nil)
        }
    }

    public func signIn() async {
        guard !isSigningIn else { return }
        isSigningIn = true
        defer { isSigningIn = false }
        signInError = nil
        do {
            try await auth.signIn(using: web)
            enterSignedIn()
        } catch {
            let wrapped = AccountError.wrap(error)
            if wrapped != .cancelled { signInError = wrapped }
        }
    }

    /// Order matters: unregister push while the access token works, then
    /// revoke the refresh token, then forget the Keychain item.
    public func signOut() async {
        await push.unregister()
        await auth.signOut()
        leave(nil)
    }

    /// Sensitive actions: `prompt=login`, switch grant, re-register push.
    public func reauthenticate() async throws -> String {
        let idToken = try await auth.reauthenticate(using: web)
        await push.register()
        return idToken
    }

    private func sessionEnded() {
        guard phase == .signedIn else { return }
        leave(.sessionExpired)
    }

    private func accountDeleted() async {
        await auth.forget()
        leave(.accountDeleted)
    }

    private func enterSignedIn() {
        push.attach(api)
        account = AccountStore(
            api: api,
            web: web,
            linkedURL: config.linkedURL,
            reauthenticate: { [weak self] in
                guard let self else { throw AccountError.signedOut }
                return try await self.reauthenticate()
            },
            accountDeleted: { [weak self] in
                await self?.accountDeleted()
            }
        )
        phase = .signedIn
    }

    private func leave(_ reason: SignedOutReason?) {
        account = nil
        pendingDestination = nil
        push.reset()
        lock.reset()
        phase = .signedOut(reason)
    }
}
