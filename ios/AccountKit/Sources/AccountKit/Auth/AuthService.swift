import Foundation

/// Opens a URL in the system browser sheet and returns the URL the IdP
/// redirected to. The app implements it with `ASWebAuthenticationSession`
/// (`Callback.https`, ephemeral session); cancelling throws `.cancelled`.
public protocol WebAuthenticating: Sendable {
    @MainActor func authenticate(url: URL, callback: URL) async throws -> URL
}

/// Sign-in, re-authentication and sign-out against the IdP.
public final class AuthService: Sendable {
    /// The API accepts a re-authentication for 10 minutes; the app asks for
    /// a new one after 8 so a slow confirmation step does not fail.
    public static let reauthMaxAge: TimeInterval = 8 * 60

    private let config: AccountConfig
    private let oidc: OIDCClient
    private let refresher: TokenRefresher
    private let now: @Sendable () -> Date
    private let deviceName: String?
    private let uiLocale: String?

    public init(
        config: AccountConfig,
        oidc: OIDCClient,
        refresher: TokenRefresher,
        deviceName: String?,
        uiLocale: String?,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.config = config
        self.oidc = oidc
        self.refresher = refresher
        self.deviceName = deviceName
        self.uiLocale = uiLocale
        self.now = now
    }

    public var isSignedIn: Bool {
        get async { await refresher.current() != nil }
    }

    /// Code flow with PKCE, state and nonce; stores the tokens.
    @discardableResult
    public func signIn(using web: any WebAuthenticating) async throws -> IDTokenClaims {
        let (tokens, claims) = try await authorize(using: web, prompt: nil)
        _ = try await refresher.replace(with: tokens, accountID: claims.sub)
        return claims
    }

    /// `prompt=login` for a sensitive action. The new code yields a new
    /// device grant, so the app switches to it and revokes the old refresh
    /// token: each phone keeps one row under "Devices". Returns the fresh
    /// ID token, which the API accepts once.
    public func reauthenticate(using web: any WebAuthenticating) async throws -> String {
        guard let previous = await refresher.current() else { throw AccountError.signedOut }
        let (tokens, claims) = try await authorize(using: web, prompt: "login")
        guard claims.sub == previous.accountID else {
            if let stray = tokens.refreshToken { try? await oidc.revoke(refreshToken: stray) }
            throw AccountError.differentAccount
        }
        guard claims.isFresh(now: now(), maxAge: Self.reauthMaxAge), let idToken = tokens.idToken else {
            if let stray = tokens.refreshToken { try? await oidc.revoke(refreshToken: stray) }
            throw AccountError.reauthTooOld
        }
        _ = try await refresher.replace(with: tokens, accountID: claims.sub)
        await revokeQuietly(previous.refreshToken)
        return idToken
    }

    /// Revokes the refresh token at the IdP, then forgets everything here.
    /// The caller unregisters push first, while the access token still works.
    public func signOut() async {
        if let current = await refresher.current() {
            await revokeQuietly(current.refreshToken)
        }
        await refresher.clear()
    }

    /// Forgets the credentials without calling the IdP (account deleted:
    /// the grant no longer exists).
    public func forget() async {
        await refresher.clear()
    }

    private func authorize(
        using web: any WebAuthenticating, prompt: String?
    ) async throws -> (TokenResponse, IDTokenClaims) {
        let endpoint = try await oidc.authorizationEndpoint()
        let request = AuthorizationRequest(
            redirectURI: config.callbackURL,
            prompt: prompt,
            deviceName: deviceName,
            uiLocale: uiLocale
        )
        let callback: URL
        do {
            callback = try await web.authenticate(url: request.url(endpoint: endpoint), callback: config.callbackURL)
        } catch {
            throw AccountError.wrap(error)
        }
        let code = try request.authorizationCode(from: callback, issuer: config.issuerString)
        let tokens = try await oidc.exchange(code: code, request: request)
        guard let idToken = tokens.idToken else { throw AccountError.invalidIDToken("missing") }
        let claims = try IDTokenClaims.decode(idToken)
        try claims.validate(issuer: config.issuerString, nonce: request.nonce, now: now())
        return (tokens, claims)
    }

    /// Revocation is best effort: one retry, then the old grant is left to
    /// expire on its own (its sliding window is 30 days).
    private func revokeQuietly(_ refreshToken: String) async {
        for _ in 0..<2 {
            do {
                try await oidc.revoke(refreshToken: refreshToken)
                return
            } catch {
                continue
            }
        }
    }
}
