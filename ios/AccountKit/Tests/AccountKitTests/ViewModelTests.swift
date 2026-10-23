import Foundation
import Synchronization
import Testing
@testable import AccountKit

/// A fake `/api/account` with an editable snapshot response.
final class FakeAccountServer: Sendable {
    let responses = Mutex<[String: (Int, Data)]>([:])

    func set(_ key: String, _ status: Int, _ body: Data = Data()) {
        responses.withLock { $0[key] = (status, body) }
    }

    func handle(_ request: Recorded) throws -> (Int, Data, [String: String]) {
        let key = "\(request.method) \(request.url.path(percentEncoded: true))"
        if let (status, body) = responses.withLock({ $0[key] }) { return (status, body, [:]) }
        if key == "GET /api/account" { return (200, try Contract.data("account.json"), [:]) }
        return (204, Data(), [:])
    }
}

@MainActor
@Suite("Account store")
struct AccountStoreTests {
    final class Calls: Sendable {
        let reauths = Mutex(0)
        let deleted = Mutex(0)
    }

    func store(
        server: FakeAccountServer = FakeAccountServer(),
        web: FakeWebAuthenticator = FakeWebAuthenticator(),
        reauthError: AccountError? = nil
    ) -> (AccountStore, StubHTTP, Calls) {
        let http = StubHTTP { try server.handle($0) }
        let calls = Calls()
        let api = AccountAPI(config: TestConfig.config, http: http, tokens: CountingTokens())
        let store = AccountStore(
            api: api, web: web, linkedURL: TestConfig.config.linkedURL,
            reauthenticate: {
                calls.reauths.withLock { $0 += 1 }
                if let reauthError { throw reauthError }
                return "fresh-id-token"
            },
            accountDeleted: { calls.deleted.withLock { $0 += 1 } }
        )
        return (store, http, calls)
    }

    @Test("load fills the snapshot")
    func load() async {
        let (store, _, _) = store()
        await store.load()
        #expect(store.phase == .loaded)
        #expect(store.snapshot?.account.username == "minhanh")
    }

    @Test("offline keeps the last snapshot and says so")
    func offlineKeepsSnapshot() async {
        let failing = Mutex(false)
        let http = StubHTTP { request in
            if failing.withLock({ $0 }) { throw URLError(.notConnectedToInternet) }
            return try FakeAccountServer().handle(request)
        }
        let api = AccountAPI(config: TestConfig.config, http: http, tokens: CountingTokens())
        let store = AccountStore(api: api, web: FakeWebAuthenticator(), linkedURL: TestConfig.config.linkedURL,
                                 reauthenticate: { "x" }, accountDeleted: {})
        await store.load()
        failing.withLock { $0 = true }
        await store.load()
        #expect(store.isOffline)
        #expect(store.snapshot?.account.username == "minhanh")
    }

    @Test("write actions need no re-authentication")
    func writeActions() async throws {
        let (store, http, calls) = store()
        await store.load()
        let snapshot = try #require(store.snapshot)
        #expect(await store.saveName("  Minh Anh  "))
        #expect(store.notice == .profileSaved)
        await store.revokeSession(snapshot.sessions[0])
        #expect(store.notice == .sessionRevoked)
        await store.revokeDevice(snapshot.devices[1])
        #expect(store.notice == .deviceRevoked)
        #expect(calls.reauths.withLock { $0 } == 0)
        #expect(http.requests.first { $0.method == "PATCH" }?.json == ["name": "Minh Anh"])
    }

    @Test("this phone is never revoked from the list")
    func currentDevice() async throws {
        let (store, http, _) = store()
        await store.load()
        let devices = store.snapshot?.devices ?? []
        let current = try #require(devices.first { $0.current })
        await store.revokeDevice(current)
        #expect(!http.requests.contains { $0.path.contains("/devices/") })
    }

    @Test("names longer than 100 characters are refused locally")
    func longName() async {
        let (store, http, _) = store()
        #expect(!(await store.saveName(String(repeating: "a", count: 101))))
        #expect(store.alert == .invalidName)
        #expect(http.requests.isEmpty)
    }

    @Test("sensitive actions re-authenticate and send the ID token")
    func sensitive() async throws {
        let (store, http, calls) = store()
        await store.load()
        let snapshot = try #require(store.snapshot)
        await store.revokeApp(snapshot.apps[0])
        await store.revokeAllSessions()
        await store.unlink(.github)
        #expect(calls.reauths.withLock { $0 } == 3)
        let sensitive = http.requests.filter { $0.method == "POST" }
        #expect(sensitive.count == 3)
        #expect(sensitive.allSatisfy { $0.json["id_token"] == "fresh-id-token" })
        #expect(store.notice == .unlinked(.github))
    }

    @Test("cancelled re-authentication sends nothing and shows no error")
    func cancelledReauth() async {
        let (store, http, _) = store(reauthError: .cancelled)
        await store.revokeAllSessions()
        #expect(store.alert == nil)
        #expect(http.requests.isEmpty)
    }

    @Test("unlinking the last method surfaces the IdP's refusal")
    func lastMethod() async {
        let server = FakeAccountServer()
        server.set("POST /api/account/providers/google/unlink", 409, json(#"{"error":"last_sign_in_method"}"#))
        let (store, _, _) = store(server: server)
        await store.unlink(.google)
        #expect(store.alert == .lastSignInMethod)
    }

    /// The IdP's answer to `POST …/link/complete` (status, body).
    typealias Completion = (Int, String)

    @Test("link: provider step, then completion through the API decides the outcome", arguments: [
        ("result=pending&ref=r-1", (200, #"{"result":"linked"}"#), nil as AccountError?),
        ("result=pending&ref=r-1", (200, #"{"result":"owned_by_other"}"#), AccountError.linkFailed(.ownedByOther)),
        ("result=pending&ref=r-1", (200, #"{"result":"something-new"}"#), AccountError.linkFailed(.failed)),
        ("result=pending&ref=r-1", (404, #"{"error":"not_found"}"#), AccountError.notFound),
    ] as [(String, Completion, AccountError?)])
    func linkPending(query: String, completion: Completion, expected: AccountError?) async throws {
        let server = FakeAccountServer()
        server.set("POST /api/account/providers/apple/link", 200, try Contract.data("link-start.json").replacingHost())
        server.set("POST /api/account/providers/apple/link/complete", completion.0, json(completion.1))
        let web = FakeWebAuthenticator { url, callback in
            #expect(url.host() == "auth.example.test")
            #expect(callback == TestConfig.config.linkedURL)
            return URL(string: "\(callback.absoluteString)?\(query)&provider=apple")!
        }
        let (store, http, _) = store(server: server, web: web)
        await store.link(.apple)
        #expect(store.alert == expected)
        #expect(store.notice == (expected == nil ? .linked(.apple) : nil))
        #expect(web.openedURLs.count == 1)
        let paths = http.requests.map { "\($0.method) \($0.path)" }
        #expect(paths == [
            "POST /api/account/providers/apple/link",
            "POST /api/account/providers/apple/link/complete",
            "GET /api/account",
        ])
        let complete = try #require(http.requests.first { $0.path.hasSuffix("/link/complete") })
        #expect(complete.json == ["ref": "r-1"])
        #expect(complete.headers["Authorization"] == "Bearer access-a")
    }

    @Test("link: a failed provider step or a pending result without ref completes nothing", arguments: [
        ("result=failed", AccountError.linkFailed(.failed)),
        ("result=expired", AccountError.linkFailed(.expired)),
        ("result=already_linked", AccountError.linkFailed(.alreadyLinked)),
        ("result=pending", AccountError.linkFailed(.failed)),
        ("result=linked", AccountError.linkFailed(.failed)),
    ])
    func linkWithoutCompletion(query: String, expected: AccountError) async throws {
        let server = FakeAccountServer()
        server.set("POST /api/account/providers/apple/link", 200, try Contract.data("link-start.json").replacingHost())
        let web = FakeWebAuthenticator { _, callback in
            URL(string: "\(callback.absoluteString)?\(query)")!
        }
        let (store, http, _) = store(server: server, web: web)
        await store.link(.apple)
        #expect(!http.requests.contains { $0.path.hasSuffix("/link/complete") })
        #expect(store.alert == expected)
        #expect(store.notice == nil)
    }

    @Test("delete requires the typed username, then re-authenticates")
    func delete() async throws {
        let (store, http, calls) = store()
        await store.load()
        #expect(!(await store.deleteAccount(typedUsername: "someone")))
        #expect(store.alert == .usernameMismatch)
        #expect(calls.reauths.withLock { $0 } == 0)
        #expect(await store.deleteAccount(typedUsername: " @MinhAnh "))
        let delete = try #require(http.requests.first { $0.method == "DELETE" })
        #expect(delete.json == ["id_token": "fresh-id-token", "username": "minhanh"])
        #expect(calls.deleted.withLock { $0 } == 1)
    }

    @Test("a failed delete keeps the account signed in")
    func deleteFails() async {
        let server = FakeAccountServer()
        server.set("DELETE /api/account", 403, json(#"{"error":"reauth_required"}"#))
        let (store, _, calls) = store(server: server)
        await store.load()
        #expect(!(await store.deleteAccount(typedUsername: "minhanh")))
        #expect(store.alert == .reauthRequired)
        #expect(calls.deleted.withLock { $0 } == 0)
    }
}

@MainActor
@Suite("App model")
struct AppModelTests {
    func model(start: Credentials?, apiStatus: Int = 204) throws -> (AppModel, StubHTTP) {
        let idp = FakeIdP()
        let http = StubHTTP { request in
            switch request.path {
            case "/.well-known/openid-configuration": return (200, TestConfig.discoveryJSON, [:])
            case "/token": return (200, idp.tokenResponse(), [:])
            case "/token/revocation": return (200, Data(), [:])
            case "/api/account": return (200, try Contract.data("account.json"), [:])
            default: return (apiStatus, Data(), [:])
            }
        }
        let web = FakeWebAuthenticator { url, callback in
            idp.remember(authorizeURL: url)
            return try FakeWebAuthenticator.approve(url, callback)
        }
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let store = InMemoryStore()
        if let start { try TokenStore(secure: store).save(start) }
        let model = AppModel.live(
            config: TestConfig.config, web: web, secureStore: store, http: http,
            deviceName: "iPhone", locale: "vi", pushEnvironment: .sandbox, defaults: defaults
        )
        return (model, http)
    }

    @Test("no credentials: sign-in screen; sign-in then shows the account")
    func signIn() async throws {
        let (model, _) = try model(start: nil)
        await model.start()
        #expect(model.phase == .signedOut(nil))
        await model.signIn()
        #expect(model.phase == .signedIn)
        #expect(model.account != nil)
    }

    @Test("sign-out unregisters push, revokes, then forgets")
    func signOutOrder() async throws {
        let (model, http) = try model(start: credentials(expiresIn: 86_400))
        await model.start()
        #expect(model.phase == .signedIn)
        await model.signOut()
        let paths = http.requests.map { "\($0.method) \($0.path)" }
        #expect(paths == ["DELETE /api/account/push-device", "GET /.well-known/openid-configuration", "POST /token/revocation"])
        #expect(model.phase == .signedOut(nil))
        #expect(model.account == nil)
    }

    @Test("re-authentication re-registers the push token on the new grant")
    func reauthReregistersPush() async throws {
        let (model, http) = try model(start: credentials(expiresIn: 86_400))
        await model.start()
        await model.push.setEnabled(true)
        await model.push.deviceTokenReceived(Data([0x01, 0x02]))
        _ = try await model.reauthenticate()
        let pushes = http.requests.filter { $0.method == "PUT" }
        #expect(pushes.count == 2)
        #expect(pushes.last?.headers["Authorization"] == "Bearer access-1")
    }

    @Test("a session ended by the IdP returns to sign-in with a reason")
    func sessionEnded() async throws {
        let (model, _) = try model(start: credentials(expiresIn: 86_400), apiStatus: 401)
        await model.start()
        let store = try #require(model.account)
        await store.revokeSession(BrowserSession(uid: "s", loginAt: nil, lastSeenAt: nil, browser: nil, os: nil, ip: nil))
        #expect(model.phase == .signedOut(.sessionExpired))
        #expect(store.alert == nil)
    }

    @Test("deleting the account ends at the sign-in screen with a confirmation")
    func deleted() async throws {
        let (model, http) = try model(start: credentials(expiresIn: 86_400))
        await model.start()
        let store = try #require(model.account)
        await store.load()
        #expect(await store.deleteAccount(typedUsername: "minhanh"))
        #expect(model.phase == .signedOut(.accountDeleted))
        // The deleted grant is not revoked afterwards: it no longer exists.
        let revocations = http.requests(to: "/token/revocation").map { $0.form["token"] }
        #expect(revocations == ["refresh-0"])
    }
}

@MainActor
@Suite("App lock")
struct AppLockTests {
    final class Authenticator: DeviceOwnerAuthenticating {
        let answer = Mutex(true)
        let calls = Mutex(0)
        func canAuthenticate() -> Bool { true }
        func authenticate(reason: String) async -> Bool {
            calls.withLock { $0 += 1 }
            return answer.withLock { $0 }
        }
    }

    final class Clock: Sendable {
        let value = Mutex(TestConfig.start)
        func advance(_ seconds: TimeInterval) { value.withLock { $0 += seconds } }
        var now: Date { value.withLock { $0 } }
    }

    func lock(enabled: Bool = false) throws -> (AppLock, Authenticator, Clock, UserDefaults) {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.set(enabled, forKey: AppLock.enabledKey)
        let auth = Authenticator()
        let clock = Clock()
        return (AppLock(defaults: defaults, authenticator: auth, now: { clock.now }), auth, clock, defaults)
    }

    @Test("off by default; the cover follows the scene")
    func defaults() throws {
        let (lock, _, clock, _) = try lock()
        #expect(!lock.isEnabled && !lock.isLocked)
        lock.sceneEnteredBackground()
        #expect(lock.isCovered)
        clock.advance(600)
        lock.sceneBecameActive()
        #expect(!lock.isCovered && !lock.isLocked)
    }

    @Test("enabled: locked at launch and after the grace period, not before")
    func gracePeriod() async throws {
        let (lock, auth, clock, _) = try lock(enabled: true)
        #expect(lock.isLocked)
        await lock.unlock(reason: "r")
        #expect(!lock.isLocked)
        lock.sceneEnteredBackground()
        clock.advance(AppLock.gracePeriod - 1)
        lock.sceneBecameActive()
        #expect(!lock.isLocked)
        lock.sceneEnteredBackground()
        clock.advance(AppLock.gracePeriod + 1)
        lock.sceneBecameActive()
        #expect(lock.isLocked)
        auth.answer.withLock { $0 = false }
        await lock.unlock(reason: "r")
        #expect(lock.isLocked)
    }

    @Test("turning the lock on or off needs a successful authentication")
    func toggle() async throws {
        let (lock, auth, _, defaults) = try lock()
        auth.answer.withLock { $0 = false }
        #expect(!(await lock.setEnabled(true, reason: "r")))
        #expect(!lock.isEnabled)
        auth.answer.withLock { $0 = true }
        #expect(await lock.setEnabled(true, reason: "r"))
        #expect(defaults.bool(forKey: AppLock.enabledKey))
        lock.reset()
        #expect(!lock.isEnabled && !defaults.bool(forKey: AppLock.enabledKey))
    }
}

@Suite("Push")
struct PushTests {
    @Test("notification kinds route to screens; unknown kinds are ignored")
    func routing() {
        #expect(PushKind.from(userInfo: ["kind": "new-sign-in"])?.destination == .sessions)
        #expect(PushKind.from(userInfo: ["kind": "provider-linked"])?.destination == .signInMethods)
        #expect(PushKind.from(userInfo: ["kind": "access-revoked"])?.destination == .devices)
        #expect(PushKind.from(userInfo: ["kind": "something"]) == nil)
        #expect(PushKind.from(userInfo: [:]) == nil)
    }

    @Test("APNs environment from the provisioning profile")
    func environment() {
        func profile(_ value: String) -> Data {
            var data = Data([0x30, 0x82, 0x01, 0x00])
            data.append(Data("""
            <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Entitlements</key>\
            <dict><key>aps-environment</key><string>\(value)</string></dict></dict></plist>
            """.utf8))
            data.append(Data([0x00, 0xff]))
            return data
        }
        #expect(APNsEnvironment.from(provisioningProfile: profile("development")) == .sandbox)
        #expect(APNsEnvironment.from(provisioningProfile: profile("production")) == .production)
        #expect(APNsEnvironment.from(provisioningProfile: nil) == .production)
        #expect(APNsEnvironment.from(provisioningProfile: Data("garbage".utf8)) == .production)
    }

    @Test("IdP locale")
    func locale() {
        #expect(IdPLocale.from(preferredLocalization: "vi") == "vi")
        #expect(IdPLocale.from(preferredLocalization: "zh-Hans") == "zh-CN")
        #expect(IdPLocale.from(preferredLocalization: "en-GB") == "en")
        #expect(IdPLocale.from(preferredLocalization: "fr") == "en")
        #expect(IdPLocale.from(preferredLocalization: nil) == "en")
    }

    @Test("link callback parsing checks the path and requires a ref when pending")
    func linkCallback() {
        let expected = TestConfig.config.linkedURL
        func parse(_ raw: String) -> LinkCallback { LinkCallback.parse(URL(string: raw)!, expected: expected) }
        #expect(parse("\(expected)?result=pending&ref=abc") == .pending(ref: "abc"))
        #expect(parse("\(expected)?result=pending&ref=") == .finished(.failed))
        #expect(parse("\(expected)?result=pending") == .finished(.failed))
        #expect(parse("\(expected)?result=expired") == .finished(.expired))
        #expect(parse("\(expected)?result=owned_by_other") == .finished(.ownedByOther))
        #expect(parse("\(expected)?result=whatever") == .finished(.failed))
        #expect(parse("\(expected)?result=linked") == .finished(.failed))
        #expect(parse("https://evil.test/ios/linked?result=pending&ref=abc") == .finished(.failed))
        #expect(parse("\(expected)") == .finished(.failed))
    }
}
