import Foundation

/// Hands out access tokens to the API client.
public protocol AccessTokenProviding: Sendable {
    /// A token that is not about to expire, refreshing first when needed.
    func validAccessToken() async throws -> String
    /// The API rejected `token` (401): refresh unless someone already did.
    func refreshRejected(_ token: String) async throws -> String
    /// The API rejected a freshly refreshed token too: the grant is dead.
    func endSession() async
}

/// Owns the credentials. Refresh tokens rotate and are single-use, so two
/// refreshes in parallel would make the IdP answer `invalid_grant` to one
/// of them; the actor runs at most one refresh and every caller waiting
/// meanwhile gets its result.
public actor TokenRefresher: AccessTokenProviding {
    /// Refresh this long before the access token expires.
    static let expiryMargin: TimeInterval = 60
    /// Used when the token response has no `expires_in`.
    static let defaultLifetime: TimeInterval = 300

    private let store: TokenStore
    private let oidc: OIDCClient
    private let now: @Sendable () -> Date
    private var credentials: Credentials?
    private var loaded = false
    private var inFlight: Task<Credentials, any Error>?
    /// Bumped whenever the credentials are replaced or cleared, so a refresh
    /// that finishes afterwards cannot write back the old grant's tokens.
    private var generation = 0
    private var sessionEndedHandler: (@Sendable () async -> Void)?

    public init(store: TokenStore, oidc: OIDCClient, now: @escaping @Sendable () -> Date = Date.init) {
        self.store = store
        self.oidc = oidc
        self.now = now
    }

    /// Called once whenever the session ends without the person asking
    /// (refresh refused, API rejects every token).
    public func onSessionEnded(_ handler: @escaping @Sendable () async -> Void) {
        sessionEndedHandler = handler
    }

    public func current() -> Credentials? {
        loadIfNeeded()
        return credentials
    }

    /// Stores credentials from a sign-in or a re-authentication.
    public func replace(with tokens: TokenResponse, accountID: String) throws -> Credentials {
        guard let refreshToken = tokens.refreshToken else { throw AccountError.invalidResponse }
        let next = makeCredentials(tokens, refreshToken: refreshToken, accountID: accountID)
        try store.save(next)
        generation += 1
        inFlight = nil
        credentials = next
        loaded = true
        return next
    }

    /// Forgets the credentials locally (sign-out, deletion, ended session).
    public func clear() {
        generation += 1
        inFlight?.cancel()
        inFlight = nil
        credentials = nil
        loaded = true
        try? store.clear()
    }

    public func validAccessToken() async throws -> String {
        loadIfNeeded()
        guard let credentials else { throw AccountError.signedOut }
        if credentials.accessTokenExpiresAt.timeIntervalSince(now()) > Self.expiryMargin {
            return credentials.accessToken
        }
        return try await refresh().accessToken
    }

    public func refreshRejected(_ token: String) async throws -> String {
        loadIfNeeded()
        guard let credentials else { throw AccountError.signedOut }
        if credentials.accessToken != token, inFlight == nil {
            return credentials.accessToken
        }
        return try await refresh().accessToken
    }

    public func endSession() async {
        clear()
        await sessionEndedHandler?()
    }

    private func refresh() async throws -> Credentials {
        if let inFlight { return try await inFlight.value }
        guard let current = credentials else { throw AccountError.signedOut }
        let task = Task { [oidc] in
            let tokens = try await oidc.refresh(current.refreshToken)
            return makeCredentials(
                tokens,
                refreshToken: tokens.refreshToken ?? current.refreshToken,
                accountID: current.accountID
            )
        }
        inFlight = task
        let started = generation
        do {
            let next = try await task.value
            guard started == generation else {
                // Signed in again or out meanwhile: use what is current now.
                if let credentials { return credentials }
                throw AccountError.signedOut
            }
            inFlight = nil
            try store.save(next)
            credentials = next
            return next
        } catch AccountError.sessionEnded where started == generation {
            inFlight = nil
            await endSession()
            throw AccountError.sessionEnded
        } catch {
            if started == generation { inFlight = nil }
            throw AccountError.wrap(error)
        }
    }

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        credentials = try? store.load()
    }

    private nonisolated func makeCredentials(
        _ tokens: TokenResponse, refreshToken: String, accountID: String
    ) -> Credentials {
        let lifetime = tokens.expiresIn.map(TimeInterval.init) ?? Self.defaultLifetime
        return Credentials(
            accessToken: tokens.accessToken,
            accessTokenExpiresAt: now().addingTimeInterval(lifetime),
            refreshToken: refreshToken,
            accountID: accountID
        )
    }
}
