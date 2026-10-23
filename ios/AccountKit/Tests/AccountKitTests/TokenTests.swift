import Foundation
import Security
import Synchronization
import Testing
@testable import AccountKit

@Suite("Token store")
struct TokenStoreTests {
    @Test("round trip and clear")
    func roundTrip() throws {
        let store = TokenStore(secure: InMemoryStore())
        #expect(try store.load() == nil)
        try store.save(credentials())
        #expect(try store.load() == credentials())
        try store.clear()
        #expect(try store.load() == nil)
    }

    @Test("unreadable content is removed")
    func corrupt() throws {
        let secure = InMemoryStore(Data("not json".utf8))
        let store = TokenStore(secure: secure)
        #expect(try store.load() == nil)
        #expect(try secure.read() == nil)
    }

    @Test("credentials never contain an ID token")
    func noIDToken() throws {
        let encoded = try JSONEncoder().encode(credentials())
        let keys = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any]).keys
        #expect(Set(keys) == ["accessToken", "accessTokenExpiresAt", "refreshToken", "accountID"])
    }

    #if os(iOS)
    /// An unsigned test bundle without a host app may be refused Keychain
    /// access (errSecMissingEntitlement); the test then shows as skipped,
    /// not passed. `swift test` on macOS never runs it (no data protection
    /// keychain without an entitlement), so it runs on the CI simulator.
    static var keychainUsable: Bool {
        let probe = KeychainStore(service: "com.hoandat.account.tests", account: "probe")
        defer { try? probe.delete() }
        return (try? probe.write(Data("probe".utf8))) != nil
    }

    @Test("Keychain item is this-device-only and survives a round trip", .enabled(if: keychainUsable))
    func keychain() throws {
        let account = UUID().uuidString
        let keychain = KeychainStore(service: "com.hoandat.account.tests", account: account)
        defer { try? keychain.delete() }
        try keychain.write(Data("one".utf8))
        try keychain.write(Data("two".utf8))
        #expect(try keychain.read() == Data("two".utf8))
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.hoandat.account.tests",
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnAttributes as String: true,
        ]
        var attributes: CFTypeRef?
        #expect(SecItemCopyMatching(query as CFDictionary, &attributes) == errSecSuccess)
        let accessible = (attributes as? [String: Any])?[kSecAttrAccessible as String] as? String
        #expect(accessible == (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String))
        try keychain.delete()
        #expect(try keychain.read() == nil)
        try keychain.delete()
    }
    #endif
}

/// Builds a refresher whose token endpoint is answered by `token`.
private func makeRefresher(
    start: Credentials?,
    token: @escaping @Sendable (Recorded) async throws -> (Int, Data, [String: String])
) throws -> (TokenRefresher, StubHTTP, TokenStore) {
    let http = StubHTTP { request in
        if request.path == "/.well-known/openid-configuration" { return (200, TestConfig.discoveryJSON, [:]) }
        return try await token(request)
    }
    let store = try seededStore(start)
    let oidc = OIDCClient(config: TestConfig.config, http: http, discovery: DiscoveryCache(config: TestConfig.config, http: http))
    return (TokenRefresher(store: store, oidc: oidc, now: { TestConfig.start }), http, store)
}

@Suite("Token refresher")
struct TokenRefresherTests {
    @Test("a valid access token is returned without a request")
    func cached() async throws {
        let (refresher, http, _) = try makeRefresher(start: credentials()) { _ in (500, Data(), [:]) }
        #expect(try await refresher.validAccessToken() == "access-0")
        #expect(http.requests.isEmpty)
    }

    @Test("two refreshes in parallel make one request")
    func singleFlight() async throws {
        let idp = FakeIdP()
        let (refresher, http, store) = try makeRefresher(start: credentials(expiresIn: 10)) { request in
            try await Task.sleep(for: .milliseconds(50))
            #expect(request.form["grant_type"] == "refresh_token")
            #expect(request.form["refresh_token"] == "refresh-0")
            #expect(request.form["client_id"] == "account-ios")
            return (200, idp.tokenResponse(), [:])
        }
        async let a = refresher.validAccessToken()
        async let b = refresher.validAccessToken()
        async let c = refresher.refreshRejected("access-0")
        let tokens = try await [a, b, c]
        #expect(tokens == ["access-1", "access-1", "access-1"])
        #expect(http.requests(to: "/token").count == 1)
        #expect(try store.load()?.refreshToken == "refresh-1")
    }

    @Test("a rejected token that was already replaced is not refreshed again")
    func staleRejection() async throws {
        let (refresher, http, _) = try makeRefresher(start: credentials(access: "access-new")) { _ in (500, Data(), [:]) }
        #expect(try await refresher.refreshRejected("access-old") == "access-new")
        #expect(http.requests.isEmpty)
    }

    @Test("invalid_grant ends the session and clears the Keychain")
    func invalidGrant() async throws {
        let ended = Mutex(0)
        let (refresher, _, store) = try makeRefresher(start: credentials(expiresIn: 0)) { _ in
            (400, json(#"{"error":"invalid_grant"}"#), [:])
        }
        await refresher.onSessionEnded { ended.withLock { $0 += 1 } }
        await #expect(throws: AccountError.sessionEnded) { try await refresher.validAccessToken() }
        #expect(ended.withLock { $0 } == 1)
        #expect(try store.load() == nil)
        await #expect(throws: AccountError.signedOut) { try await refresher.validAccessToken() }
    }

    @Test("offline or 5xx keeps the credentials")
    func transientFailure() async throws {
        let attempts = Mutex(0)
        let (refresher, _, store) = try makeRefresher(start: credentials(expiresIn: 0)) { _ in
            let n = attempts.withLock { value -> Int in
                value += 1
                return value
            }
            if n == 1 { throw URLError(.notConnectedToInternet) }
            return (503, Data(), [:])
        }
        await #expect(throws: AccountError.offline) { try await refresher.validAccessToken() }
        await #expect(throws: AccountError.server(status: 503, code: nil)) { try await refresher.validAccessToken() }
        #expect(try store.load() == credentials(expiresIn: 0))
    }

    @Test("no credentials means signed out")
    func signedOut() async throws {
        let (refresher, _, _) = try makeRefresher(start: nil) { _ in (500, Data(), [:]) }
        await #expect(throws: AccountError.signedOut) { try await refresher.validAccessToken() }
    }
}

@MainActor
@Suite("Sign-in and re-authentication")
struct AuthServiceTests {
    struct Harness {
        let auth: AuthService
        let refresher: TokenRefresher
        let http: StubHTTP
        let web: FakeWebAuthenticator
    }

    func harness(start: Credentials?, idp: FakeIdP, tokenSub: String? = nil) throws -> Harness {
        let http = StubHTTP { request in
            switch request.path {
            case "/.well-known/openid-configuration": return (200, TestConfig.discoveryJSON, [:])
            case "/token": return (200, idp.tokenResponse(sub: tokenSub), [:])
            case "/token/revocation": return (200, Data(), [:])
            default: return (404, Data(), [:])
            }
        }
        let oidc = OIDCClient(config: TestConfig.config, http: http, discovery: DiscoveryCache(config: TestConfig.config, http: http))
        let refresher = TokenRefresher(store: try seededStore(start), oidc: oidc, now: { TestConfig.start })
        let auth = AuthService(
            config: TestConfig.config, oidc: oidc, refresher: refresher,
            deviceName: "iPhone", uiLocale: "vi", now: { TestConfig.start }
        )
        let web = FakeWebAuthenticator { url, callback in
            idp.remember(authorizeURL: url)
            return try FakeWebAuthenticator.approve(url, callback)
        }
        return Harness(auth: auth, refresher: refresher, http: http, web: web)
    }

    @Test("sign-in exchanges the code with the PKCE verifier and stores tokens")
    func signIn() async throws {
        let h = try harness(start: nil, idp: FakeIdP())
        let claims = try await h.auth.signIn(using: h.web)
        #expect(claims.sub == "acc_test")
        let authorize = try #require(h.web.openedURLs.first)
        let exchange = try #require(h.http.requests(to: "/token").first?.form)
        #expect(exchange["grant_type"] == "authorization_code")
        #expect(exchange["redirect_uri"] == "\(TestConfig.issuer)/ios/callback")
        let verifier = try #require(exchange["code_verifier"])
        #expect(PKCE(verifier: verifier).challenge == FakeWebAuthenticator.query(authorize, "code_challenge"))
        #expect(await h.refresher.current()?.refreshToken == "refresh-1")
    }

    @Test("a nonce that does not match is refused")
    func nonceMismatch() async throws {
        let idp = FakeIdP()
        let h = try harness(start: nil, idp: idp)
        let web = FakeWebAuthenticator { url, callback in
            idp.remember(authorizeURL: URL(string: "https://x.test/?nonce=forged")!)
            return try FakeWebAuthenticator.approve(url, callback)
        }
        await #expect(throws: AccountError.invalidIDToken("nonce")) { try await h.auth.signIn(using: web) }
        #expect(await h.refresher.current() == nil)
    }

    @Test("cancelling the sheet is .cancelled and stores nothing")
    func cancelled() async throws {
        let h = try harness(start: nil, idp: FakeIdP())
        let web = FakeWebAuthenticator { _, _ in throw AccountError.cancelled }
        await #expect(throws: AccountError.cancelled) { try await h.auth.signIn(using: web) }
        #expect(h.http.requests(to: "/token").isEmpty)
    }

    @Test("re-authentication switches to the new grant, then revokes the old refresh token")
    func reauthSwitchesGrant() async throws {
        let h = try harness(start: credentials(), idp: FakeIdP())
        let idToken = try await h.auth.reauthenticate(using: h.web)
        #expect(try IDTokenClaims.decode(idToken).sub == "acc_test")
        #expect(FakeWebAuthenticator.query(try #require(h.web.openedURLs.first), "prompt") == "login")
        #expect(await h.refresher.current()?.refreshToken == "refresh-1")
        let revocations = h.http.requests(to: "/token/revocation")
        #expect(revocations.count == 1)
        #expect(revocations.first?.form["token"] == "refresh-0")
        #expect(revocations.first?.form["token_type_hint"] == "refresh_token")
        // The exchange happened before the revocation: one grant at all times.
        let paths = h.http.requests.map(\.path).filter { $0 != "/.well-known/openid-configuration" }
        #expect(paths == ["/token", "/token/revocation"])
    }

    @Test("re-authenticating as someone else keeps the old grant and revokes the new one")
    func differentAccount() async throws {
        let h = try harness(start: credentials(), idp: FakeIdP(), tokenSub: "acc_other")
        await #expect(throws: AccountError.differentAccount) { try await h.auth.reauthenticate(using: h.web) }
        #expect(await h.refresher.current()?.refreshToken == "refresh-0")
        #expect(h.http.requests(to: "/token/revocation").first?.form["token"] == "refresh-1")
    }

    @Test("a stale auth_time is refused")
    func staleAuthTime() async throws {
        let idp = FakeIdP(authTime: { TestConfig.start.addingTimeInterval(-3600) })
        let h = try harness(start: credentials(), idp: idp)
        await #expect(throws: AccountError.reauthTooOld) { try await h.auth.reauthenticate(using: h.web) }
        #expect(await h.refresher.current()?.refreshToken == "refresh-0")
    }

    @Test("sign-out revokes the refresh token and clears the store")
    func signOut() async throws {
        let h = try harness(start: credentials(), idp: FakeIdP())
        await h.auth.signOut()
        #expect(h.http.requests(to: "/token/revocation").first?.form["token"] == "refresh-0")
        #expect(await h.refresher.current() == nil)
    }
}
