import Foundation
import Testing
@testable import AccountKit

@Suite("PKCE and random values")
struct PKCETests {
    @Test("RFC 7636 appendix B vector")
    func rfcVector() {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        #expect(PKCE.method == "S256")
    }

    @Test("generated verifiers are 43 base64url characters and unique")
    func generated() {
        let values = (0..<50).map { _ in PKCE.generate().verifier }
        #expect(Set(values).count == values.count)
        for value in values {
            #expect(value.count == 43)
            #expect(value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        }
    }

    @Test("base64url round trip without padding")
    func base64URL() {
        let data = Data([0xfb, 0xff, 0xfe, 0x00, 0x01])
        let encoded = data.base64URLEncodedString()
        #expect(!encoded.contains("=") && !encoded.contains("+") && !encoded.contains("/"))
        #expect(Data(base64URLEncoded: encoded) == data)
        #expect(Data(base64URLEncoded: "a") == nil)
    }
}

@Suite("Configuration")
struct ConfigTests {
    @Test("issuer must be https without query; trailing slash dropped")
    func issuer() throws {
        let config = try AccountConfig(issuer: "https://auth.example.test/")
        #expect(config.issuerString == "https://auth.example.test")
        #expect(config.callbackURL.absoluteString == "https://auth.example.test/ios/callback")
        #expect(config.linkedURL.absoluteString == "https://auth.example.test/ios/linked")
        #expect(config.apiBaseURL.absoluteString == "https://auth.example.test/api/account")
        #expect(throws: AccountError.invalidConfiguration("issuer")) { try AccountConfig(issuer: "http://auth.example.test") }
        #expect(throws: AccountError.invalidConfiguration("issuer")) { try AccountConfig(issuer: "https://auth.example.test?x=1") }
        #expect(throws: AccountError.invalidConfiguration("issuer")) { try AccountConfig(issuer: "") }
    }
}

@Suite("Authorization request and callback")
struct AuthorizationRequestTests {
    let config = TestConfig.config

    func request(prompt: String? = nil) -> AuthorizationRequest {
        AuthorizationRequest(redirectURI: config.callbackURL, prompt: prompt, deviceName: "iPhone của Đạt", uiLocale: "vi")
    }

    @Test("authorize URL carries PKCE, state, nonce, scope and the extras")
    func url() throws {
        let req = request(prompt: "login")
        let url = req.url(endpoint: URL(string: "\(TestConfig.issuer)/auth")!)
        let q = { (name: String) in FakeWebAuthenticator.query(url, name) }
        #expect(q("response_type") == "code")
        #expect(q("client_id") == "account-ios")
        #expect(q("redirect_uri") == "\(TestConfig.issuer)/ios/callback")
        #expect(q("scope") == "openid profile email account")
        #expect(q("state") == req.state)
        #expect(q("nonce") == req.nonce)
        #expect(q("code_challenge") == req.pkce.challenge)
        #expect(q("code_challenge_method") == "S256")
        #expect(q("prompt") == "login")
        #expect(q("device_name") == "iPhone của Đạt")
        #expect(q("ui_locales") == "vi")
        #expect(req.state != req.nonce)
    }

    @Test("callback with matching state and issuer yields the code")
    func goodCallback() throws {
        let req = request()
        let url = URL(string: "\(TestConfig.issuer)/ios/callback?code=abc&state=\(req.state)&iss=\(TestConfig.issuer)")!
        #expect(try req.authorizationCode(from: url, issuer: TestConfig.issuer) == "abc")
    }

    @Test("callback failures", arguments: [
        ("https://auth.example.test/ios/callback?code=abc&state=WRONG", AccountError.stateMismatch),
        ("https://evil.example.test/ios/callback?code=abc&state=STATE", AccountError.invalidCallback),
        ("https://auth.example.test/ios/linked?code=abc&state=STATE", AccountError.invalidCallback),
        ("https://auth.example.test/ios/callback?state=STATE", AccountError.invalidCallback),
        ("https://auth.example.test/ios/callback?code=abc&state=STATE&iss=https://other.test", AccountError.issuerMismatch),
        ("https://auth.example.test/ios/callback?error=access_denied&state=STATE", AccountError.cancelled),
        ("https://auth.example.test/ios/callback?error=login_required&state=STATE", AccountError.authorizationFailed("login_required")),
    ])
    func badCallbacks(raw: String, expected: AccountError) {
        let req = AuthorizationRequest(redirectURI: config.callbackURL, state: "STATE")
        #expect(throws: expected) { try req.authorizationCode(from: URL(string: raw)!, issuer: TestConfig.issuer) }
    }

    @Test("device names follow the IdP pattern")
    func deviceNames() {
        #expect(DeviceName.sanitized("Đạt's iPhone 15 (Pro)") == "Đạt's iPhone 15 (Pro)")
        #expect(DeviceName.sanitized("📱 iPhone") == "iPhone")
        #expect(DeviceName.sanitized("<script>") == "script")
        #expect(DeviceName.sanitized("   ") == nil)
        #expect(DeviceName.sanitized(String(repeating: "a", count: 80))?.count == 64)
        // Decomposed Vietnamese is precomposed, so no combining marks remain.
        #expect(DeviceName.sanitized("Đa\u{0323}\u{0302}t") == "Đật")
    }
}

@Suite("ID token claims")
struct IDTokenTests {
    let now = TestConfig.start

    func token(_ overrides: [String: Any] = [:]) -> String {
        var claims: [String: Any] = [
            "iss": TestConfig.issuer, "sub": "acc_1", "aud": "account-ios",
            "exp": now.timeIntervalSince1970 + 600, "nonce": "n1", "auth_time": now.timeIntervalSince1970 - 30,
        ]
        claims.merge(overrides) { $1 }
        return makeJWT(claims)
    }

    @Test("valid token")
    func valid() throws {
        let claims = try IDTokenClaims.decode(token())
        try claims.validate(issuer: TestConfig.issuer, nonce: "n1", now: now)
        #expect(claims.sub == "acc_1")
        #expect(claims.isFresh(now: now, maxAge: 60))
        #expect(!claims.isFresh(now: now.addingTimeInterval(120), maxAge: 60))
    }

    @Test("audience as an array")
    func audienceArray() throws {
        let claims = try IDTokenClaims.decode(token(["aud": ["other", "account-ios"]]))
        try claims.validate(issuer: TestConfig.issuer, nonce: "n1", now: now)
    }

    @Test("rejections", arguments: [
        (["iss": "https://evil.test"], "iss"),
        (["aud": "chat-mobile"], "aud"),
        (["nonce": "other"], "nonce"),
        (["exp": 1_000.0], "exp"),
    ] as [([String: any Sendable], String)])
    func rejections(overrides: [String: any Sendable], reason: String) throws {
        let claims = try IDTokenClaims.decode(token(overrides.mapValues { $0 as Any }))
        #expect(throws: AccountError.invalidIDToken(reason)) {
            try claims.validate(issuer: TestConfig.issuer, nonce: "n1", now: now)
        }
    }

    @Test("missing auth_time is never fresh; malformed tokens fail")
    func malformed() throws {
        let claims = try IDTokenClaims.decode(makeJWT(["iss": "x", "sub": "s", "aud": "account-ios", "exp": 1]))
        #expect(!claims.isFresh(now: now, maxAge: 600))
        #expect(throws: AccountError.invalidIDToken("format")) { try IDTokenClaims.decode("not-a-jwt") }
        #expect(throws: AccountError.invalidIDToken("claims")) { try IDTokenClaims.decode(makeJWT(["sub": "s"])) }
    }
}

@Suite("Discovery")
struct DiscoveryTests {
    @Test("loads once and validates")
    func loadsOnce() async throws {
        let http = StubHTTP { _ in (200, TestConfig.discoveryJSON, [:]) }
        let cache = DiscoveryCache(config: TestConfig.config, http: http)
        async let a = cache.document()
        async let b = cache.document()
        let (first, second) = try await (a, b)
        #expect(first == second)
        #expect(first.tokenEndpoint.absoluteString == "\(TestConfig.issuer)/token")
        _ = try await cache.document()
        #expect(http.requests.count == 1)
        #expect(http.requests.first?.path == "/.well-known/openid-configuration")
    }

    @Test("issuer mismatch and foreign endpoints are refused")
    func refusesTampering() async throws {
        let wrongIssuer = json(#"{"issuer":"https://evil.test","authorization_endpoint":"https://auth.example.test/auth","token_endpoint":"https://auth.example.test/token"}"#)
        let foreign = json(#"{"issuer":"https://auth.example.test","authorization_endpoint":"https://auth.example.test/auth","token_endpoint":"https://evil.test/token"}"#)
        for (body, expected) in [(wrongIssuer, AccountError.issuerMismatch), (foreign, .invalidConfiguration("endpoint"))] {
            let cache = DiscoveryCache(config: TestConfig.config, http: StubHTTP { _ in (200, body, [:]) })
            await #expect(throws: expected) { try await cache.document() }
        }
    }

    @Test("offline is reported and not cached")
    func offline() async throws {
        let calls = StubHTTP { _ in throw URLError(.notConnectedToInternet) }
        let cache = DiscoveryCache(config: TestConfig.config, http: calls)
        await #expect(throws: AccountError.offline) { try await cache.document() }
        await #expect(throws: AccountError.offline) { try await cache.document() }
        #expect(calls.requests.count == 2)
    }
}
