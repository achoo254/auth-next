import Foundation
import Synchronization
import Testing
@testable import AccountKit

@Suite("Contract fixtures decode")
struct ContractDecodingTests {
    @Test("full account")
    func full() throws {
        let snapshot = try APICoding.decoder().decode(AccountSnapshot.self, from: Contract.data("account.json"))
        #expect(snapshot.account.username == "minhanh")
        #expect(snapshot.account.name == "Nguyễn Minh Anh")
        #expect(snapshot.account.emailVerifiedBy == .google)
        #expect(snapshot.providers.map(\.provider) == [.apple, .google, .github])
        #expect(snapshot.providers[0].canLink)
        #expect(!snapshot.providers[1].canLink && snapshot.providers[1].canUnlink)
        #expect(snapshot.providers[2].login == "minhanh")
        #expect(snapshot.telegram.linked)
        #expect(snapshot.sessions.count == 2)
        #expect(snapshot.sessions[1].browser == nil)
        #expect(snapshot.devices.filter(\.current).map(\.clientId) == ["account-ios"])
        #expect(snapshot.apps.map(\.clientId) == ["localman-web", "dcr_Mcp7Example"])
        #expect(snapshot.canDelete)
        // Milliseconds are kept.
        let lastSeen = try #require(snapshot.sessions[0].lastSeenAt)
        #expect(abs(lastSeen.timeIntervalSince1970.truncatingRemainder(dividingBy: 1) - 0.345) < 0.001)
    }

    @Test("minimal account: absent optionals, empty lists, dates without fraction")
    func minimal() throws {
        let snapshot = try APICoding.decoder().decode(AccountSnapshot.self, from: Contract.data("account-minimal.json"))
        #expect(snapshot.account.email == nil && snapshot.account.name == nil && snapshot.account.picture == nil)
        #expect(snapshot.sessions.isEmpty && snapshot.devices.isEmpty && snapshot.apps.isEmpty)
        #expect(!snapshot.telegram.available)
        #expect(!snapshot.canDelete)
        #expect(snapshot.providers.first?.canUnlink == false)
    }

    @Test("unknown fields and providers do not break decoding")
    func forwardCompatible() throws {
        let snapshot = try APICoding.decoder().decode(AccountSnapshot.self, from: Contract.data("account-forward-compatible.json"))
        #expect(snapshot.account.reclaimedEmail?.email == "old@example.com")
        #expect(snapshot.providers.last?.provider == ProviderID(rawValue: "microsoft"))
        #expect(snapshot.providers.last?.provider.displayName == "Microsoft")
    }

    @Test("every documented error code maps to an app error")
    func errors() throws {
        struct Entry: Decodable { let status: Int; let body: APIErrorBody }
        let entries = try JSONDecoder().decode([Entry].self, from: Contract.data("errors.json"))
        let mapped = Dictionary(uniqueKeysWithValues: entries.map {
            ($0.body.error, AccountError.fromAPI(status: $0.status, body: $0.body, retryAfter: "30"))
        })
        #expect(mapped["invalid_token"] == .sessionEnded)
        #expect(mapped["reauth_required"] == .reauthRequired)
        #expect(mapped["not_found"] == .notFound)
        #expect(mapped["last_sign_in_method"] == .lastSignInMethod)
        #expect(mapped["provider_unavailable"] == .providerUnavailable)
        #expect(mapped["already_linked"] == .alreadyLinked)
        #expect(mapped["username_mismatch"] == .usernameMismatch)
        #expect(mapped["invalid_name"] == .invalidName)
        #expect(mapped["rate_limited"] == .rateLimited(retryAfter: 30))
        #expect(mapped["insufficient_scope"] == .server(status: 403, code: "insufficient_scope"))
        #expect(mapped["server_error"] == .server(status: 500, code: "server_error"))
        #expect(AccountError.fromAPI(status: 502, body: nil, retryAfter: nil) == .server(status: 502, code: nil))
    }

    @Test("push registration body matches the fixture")
    func pushBody() throws {
        let expected = try JSONDecoder().decode([String: String].self, from: Contract.data("push-device.json"))
        let bytes: [UInt8] = (0..<32).map { (index: Int) -> UInt8 in UInt8(truncatingIfNeeded: index * 17) }
        let token = Data(bytes)
        let registration = PushDeviceRegistration(deviceToken: token, environment: .sandbox, locale: "vi")
        #expect(Set(registration.body.keys) == Set(expected.keys))
        #expect(registration.token.count == 64)
        #expect(registration.token == registration.token.lowercased())
        #expect(registration.body["environment"] == expected["environment"])
    }
}

/// An API whose token provider counts refreshes and endings.
final class CountingTokens: AccessTokenProviding {
    let refreshes = Mutex(0)
    let ended = Mutex(0)
    func validAccessToken() async throws -> String { "access-a" }
    func refreshRejected(_ token: String) async throws -> String {
        refreshes.withLock { $0 += 1 }
        return "access-b"
    }
    func endSession() async { ended.withLock { $0 += 1 } }
}

@Suite("Account API requests")
struct AccountAPIRequestTests {
    func api(_ handler: @escaping StubHTTP.Handler) -> (AccountAPI, StubHTTP, CountingTokens) {
        let http = StubHTTP(handler)
        let tokens = CountingTokens()
        return (AccountAPI(config: TestConfig.config, http: http, tokens: tokens), http, tokens)
    }

    @Test("each endpoint uses the documented method, path and body")
    func shapes() async throws {
        let (api, http, _) = api { request in
            if request.path.hasSuffix("/link") { return (200, try Contract.data("link-start.json").replacingHost(), [:]) }
            return (204, Data(), [:])
        }
        try await api.updateProfile(name: "Minh Anh")
        try await api.revokeSession(uid: "sess_1")
        try await api.revokeDevice(grantID: "grt/1")
        try await api.revokeApp(clientID: "localman-web", idToken: "id-1")
        try await api.revokeAllSessions(idToken: "id-2")
        try await api.unlink(provider: .github, idToken: "id-3")
        _ = try await api.startLink(provider: .google, idToken: "id-4")
        try await api.deleteAccount(username: "minhanh", idToken: "id-5")
        try await api.registerPushDevice(PushDeviceRegistration(deviceToken: Data([0xab, 0x01]), environment: .production, locale: "en"))
        try await api.deletePushDevice()
        let seen = http.requests.map { "\($0.method) \($0.url.path(percentEncoded: true))" }
        #expect(seen == [
            "PATCH /api/account/profile",
            "POST /api/account/sessions/sess_1/revoke",
            "POST /api/account/devices/grt%2F1/revoke",
            "POST /api/account/apps/localman-web/revoke",
            "POST /api/account/sessions/revoke-all",
            "POST /api/account/providers/github/unlink",
            "POST /api/account/providers/google/link",
            "DELETE /api/account",
            "PUT /api/account/push-device",
            "DELETE /api/account/push-device",
        ])
        let bodies = http.requests.map(\.json)
        #expect(bodies[0] == ["name": "Minh Anh"])
        #expect(bodies[1].isEmpty && http.requests[1].body == nil)
        #expect(bodies[3] == ["id_token": "id-1"])
        #expect(bodies[4] == ["id_token": "id-2"])
        #expect(bodies[5] == ["id_token": "id-3"])
        #expect(bodies[7] == ["id_token": "id-5", "username": "minhanh"])
        #expect(bodies[8] == ["token": "ab01", "environment": "production", "locale": "en"])
        for request in http.requests {
            #expect(request.headers["Authorization"] == "Bearer access-a")
        }
    }

    @Test("401 refreshes once and retries")
    func retryAfterRefresh() async throws {
        let (api, http, tokens) = api { request in
            request.headers["Authorization"] == "Bearer access-a"
                ? (401, json(#"{"error":"invalid_token"}"#), ["WWW-Authenticate": "Bearer error=\"invalid_token\""])
                : (200, try Contract.data("account.json"), [:])
        }
        let snapshot = try await api.snapshot()
        #expect(snapshot.account.username == "minhanh")
        #expect(http.requests.count == 2)
        #expect(tokens.refreshes.withLock { $0 } == 1)
    }

    @Test("401 after a refresh ends the session")
    func secondUnauthorized() async throws {
        let (api, _, tokens) = api { _ in (401, Data(), [:]) }
        await #expect(throws: AccountError.sessionEnded) { try await api.snapshot() }
        #expect(tokens.ended.withLock { $0 } == 1)
    }

    @Test("errors, offline and malformed bodies")
    func failures() async throws {
        let (conflict, _, _) = api { _ in (409, json(#"{"error":"last_sign_in_method"}"#), [:]) }
        await #expect(throws: AccountError.lastSignInMethod) { try await conflict.unlink(provider: .google, idToken: "x") }
        let (limited, _, _) = api { _ in (429, Data(), ["Retry-After": "12"]) }
        await #expect(throws: AccountError.rateLimited(retryAfter: 12)) { try await limited.revokeSession(uid: "s") }
        let (offline, _, _) = api { _ in throw URLError(.networkConnectionLost) }
        await #expect(throws: AccountError.offline) { try await offline.snapshot() }
        let (garbage, _, _) = api { _ in (200, json("{}"), [:]) }
        await #expect(throws: AccountError.invalidResponse) { try await garbage.snapshot() }
    }

    @Test("a link URL off the issuer is refused")
    func foreignLinkURL() async throws {
        let (api, _, _) = api { _ in (200, json(#"{"url":"https://evil.test/oauth/google/start"}"#), [:]) }
        await #expect(throws: AccountError.invalidResponse) { try await api.startLink(provider: .google, idToken: "x") }
    }
}

extension Data {
    /// The fixture names the production host; tests run against example.test.
    func replacingHost() -> Data {
        Data(String(decoding: self, as: UTF8.self)
            .replacingOccurrences(of: "auth.hoandat.com", with: "auth.example.test").utf8)
    }
}
