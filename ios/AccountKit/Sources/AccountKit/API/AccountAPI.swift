import Foundation

/// Client of `/api/account` (phase 02 of the iOS plan). Every call carries
/// the access token of `account-ios`; a 401 triggers one refresh and one
/// retry, and a second 401 ends the session. Sensitive calls take the ID
/// token of a re-authentication done just before (`AuthService.reauthenticate`).
public struct AccountAPI: Sendable {
    private let baseURL: URL
    private let issuerHost: String
    private let http: any HTTPClient
    private let tokens: any AccessTokenProviding

    public init(config: AccountConfig, http: any HTTPClient, tokens: any AccessTokenProviding) {
        baseURL = config.apiBaseURL
        issuerHost = config.host
        self.http = http
        self.tokens = tokens
    }

    public func snapshot() async throws -> AccountSnapshot {
        let data = try await send("GET", [])
        do {
            return try APICoding.decoder().decode(AccountSnapshot.self, from: data)
        } catch {
            throw AccountError.invalidResponse
        }
    }

    public func updateProfile(name: String) async throws {
        try await send("PATCH", ["profile"], body: ["name": name])
    }

    public func revokeSession(uid: String) async throws {
        try await send("POST", ["sessions", uid, "revoke"])
    }

    public func revokeDevice(grantID: String) async throws {
        try await send("POST", ["devices", grantID, "revoke"])
    }

    public func revokeApp(clientID: String, idToken: String) async throws {
        try await send("POST", ["apps", clientID, "revoke"], body: ["id_token": idToken])
    }

    public func revokeAllSessions(idToken: String) async throws {
        try await send("POST", ["sessions", "revoke-all"], body: ["id_token": idToken])
    }

    public func unlink(provider: ProviderID, idToken: String) async throws {
        try await send("POST", ["providers", provider.rawValue, "unlink"], body: ["id_token": idToken])
    }

    /// The IdP page to open in the browser sheet; it must be on the issuer.
    public func startLink(provider: ProviderID, idToken: String) async throws -> URL {
        let data = try await send("POST", ["providers", provider.rawValue, "link"], body: ["id_token": idToken])
        guard
            let start = try? APICoding.decoder().decode(LinkStart.self, from: data),
            start.url.scheme == "https", start.url.host() == issuerHost
        else {
            throw AccountError.invalidResponse
        }
        return start.url
    }

    /// Second half of a provider link: the `ref` from `/ios/linked?result=pending`
    /// is accepted only together with this grant's bearer token.
    public func completeLink(provider: ProviderID, ref: String) async throws -> LinkOutcome {
        let data = try await send("POST", ["providers", provider.rawValue, "link", "complete"], body: ["ref": ref])
        guard let completion = try? APICoding.decoder().decode(LinkCompletion.self, from: data) else {
            throw AccountError.invalidResponse
        }
        return LinkOutcome(result: completion.result)
    }

    public func deleteAccount(username: String, idToken: String) async throws {
        try await send("DELETE", [], body: ["id_token": idToken, "username": username])
    }

    public func registerPushDevice(_ registration: PushDeviceRegistration) async throws {
        try await send("PUT", ["push-device"], body: registration.body)
    }

    public func deletePushDevice() async throws {
        try await send("DELETE", ["push-device"])
    }

    @discardableResult
    private func send(_ method: String, _ path: [String], body: [String: String]? = nil) async throws -> Data {
        var url = baseURL
        for component in path { url.append(component: component) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try APICoding.encoder().encode(body)
        }
        let first = try await tokens.validAccessToken()
        let (data, response) = try await perform(request, token: first)
        guard response.statusCode == 401 else { return try check(data, response) }
        let second = try await tokens.refreshRejected(first)
        let (retryData, retryResponse) = try await perform(request, token: second)
        if retryResponse.statusCode == 401 {
            await tokens.endSession()
            throw AccountError.sessionEnded
        }
        return try check(retryData, retryResponse)
    }

    private func perform(_ request: URLRequest, token: String) async throws -> (Data, HTTPURLResponse) {
        var authorized = request
        authorized.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            return try await http.send(authorized)
        } catch {
            throw AccountError.wrap(error)
        }
    }

    private func check(_ data: Data, _ response: HTTPURLResponse) throws -> Data {
        if (200..<300).contains(response.statusCode) { return data }
        let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
        throw AccountError.fromAPI(
            status: response.statusCode,
            body: body,
            retryAfter: response.value(forHTTPHeaderField: "Retry-After")
        )
    }
}
