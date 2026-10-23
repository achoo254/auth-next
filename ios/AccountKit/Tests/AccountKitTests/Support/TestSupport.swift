import Foundation
import Synchronization
@testable import AccountKit

/// Shared fixtures of the JSON contract between the IdP (Node) and the app.
enum Contract {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // …/AccountKitTests/Support
        .deletingLastPathComponent() // …/Tests/AccountKitTests
        .deletingLastPathComponent() // …/AccountKit/Tests
        .deletingLastPathComponent() // ios/AccountKit
        .deletingLastPathComponent() // ios
        .appending(path: "contract")

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: name))
    }
}

enum TestConfig {
    static let issuer = "https://auth.example.test"
    static let config = try! AccountConfig(issuer: issuer)
    /// Now, to the second: AppModel.live runs on the real clock.
    static let start = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))

    static var discoveryJSON: Data {
        Data("""
        {"issuer":"\(issuer)","authorization_endpoint":"\(issuer)/auth",
         "token_endpoint":"\(issuer)/token","revocation_endpoint":"\(issuer)/token/revocation",
         "code_challenge_methods_supported":["S256"]}
        """.utf8)
    }
}

/// A recorded request with its form or JSON body decoded for assertions.
struct Recorded: Sendable {
    let method: String
    let url: URL
    let headers: [String: String]
    let body: Data?

    var path: String { url.path() }

    var form: [String: String] {
        guard let body, let text = String(data: body, encoding: .utf8) else { return [:] }
        var fields: [String: String] = [:]
        for pair in text.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            fields[parts[0]] = parts[1].removingPercentEncoding
        }
        return fields
    }

    var json: [String: String] {
        guard let body, let object = try? JSONSerialization.jsonObject(with: body) as? [String: String] else {
            return [:]
        }
        return object
    }
}

/// Routes requests to a handler and records them; never touches the network.
final class StubHTTP: HTTPClient {
    typealias Handler = @Sendable (Recorded) async throws -> (Int, Data, [String: String])

    private let handler: Handler
    private let log = Mutex<[Recorded]>([])

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var requests: [Recorded] { log.withLock { $0 } }

    func requests(to path: String) -> [Recorded] {
        requests.filter { $0.path == path }
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        let recorded = Recorded(
            method: request.httpMethod ?? "GET",
            url: url,
            headers: request.allHTTPHeaderFields ?? [:],
            body: request.httpBody
        )
        log.withLock { $0.append(recorded) }
        let (status, data, headers) = try await handler(recorded)
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            throw URLError(.badServerResponse)
        }
        return (data, response)
    }
}

func json(_ text: String) -> Data { Data(text.utf8) }

/// An unsigned JWT with the given claims (the app reads claims only).
func makeJWT(_ claims: [String: Any]) -> String {
    let header = Data(#"{"alg":"ES256","typ":"JWT"}"#.utf8).base64URLEncodedString()
    let payload = (try? JSONSerialization.data(withJSONObject: claims)) ?? Data()
    return "\(header).\(payload.base64URLEncodedString()).c2lnbmF0dXJl"
}

/// Plays the browser sheet: reads state from the authorize URL and answers
/// with a callback carrying a code, or with whatever `respond` returns.
final class FakeWebAuthenticator: WebAuthenticating {
    typealias Responder = @Sendable (URL, URL) throws -> URL
    private let respond: Responder
    private let opened = Mutex<[URL]>([])

    init(_ respond: @escaping Responder = FakeWebAuthenticator.approve) {
        self.respond = respond
    }

    var openedURLs: [URL] { opened.withLock { $0 } }

    @MainActor func authenticate(url: URL, callback: URL) async throws -> URL {
        opened.withLock { $0.append(url) }
        return try respond(url, callback)
    }

    static func query(_ url: URL, _ name: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }

    @Sendable static func approve(_ url: URL, _ callback: URL) throws -> URL {
        let state = query(url, "state") ?? ""
        return URL(string: "\(callback.absoluteString)?code=code-\(state.prefix(6))&state=\(state)&iss=\(TestConfig.issuer)")!
    }
}

/// A token endpoint that issues numbered tokens; the nonce of the last
/// authorize URL goes into the ID token, like the IdP does.
final class FakeIdP: Sendable {
    let sub: String
    private let counter = Mutex(0)
    private let lastNonce = Mutex<String?>(nil)
    private let authTime: @Sendable () -> Date

    init(sub: String = "acc_test", authTime: @escaping @Sendable () -> Date = { TestConfig.start }) {
        self.sub = sub
        self.authTime = authTime
    }

    func remember(authorizeURL url: URL) {
        lastNonce.withLock { $0 = FakeWebAuthenticator.query(url, "nonce") }
    }

    func tokenResponse(sub overrideSub: String? = nil) -> Data {
        let n = counter.withLock { value -> Int in
            value += 1
            return value
        }
        let claims: [String: Any] = [
            "iss": TestConfig.issuer, "sub": overrideSub ?? sub, "aud": AccountConfig.clientID,
            "exp": TestConfig.start.timeIntervalSince1970 + 3600,
            "iat": TestConfig.start.timeIntervalSince1970,
            "auth_time": authTime().timeIntervalSince1970,
            "nonce": lastNonce.withLock { $0 } ?? "",
        ]
        let body: [String: Any] = [
            "access_token": "access-\(n)", "token_type": "Bearer", "expires_in": 3600,
            "refresh_token": "refresh-\(n)", "id_token": makeJWT(claims), "scope": "openid profile email account",
        ]
        return (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
    }
}

func credentials(access: String = "access-0", refresh: String = "refresh-0", expiresIn: TimeInterval = 3600) -> Credentials {
    Credentials(
        accessToken: access,
        accessTokenExpiresAt: TestConfig.start.addingTimeInterval(expiresIn),
        refreshToken: refresh,
        accountID: "acc_test"
    )
}

func seededStore(_ value: Credentials?) throws -> TokenStore {
    let store = TokenStore(secure: InMemoryStore())
    if let value { try store.save(value) }
    return store
}
