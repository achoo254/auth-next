import Foundation

/// A successful token endpoint response (RFC 6749 §5.1).
public struct TokenResponse: Decodable, Sendable, Equatable {
    public let accessToken: String
    public let tokenType: String
    public let expiresIn: Int?
    public let refreshToken: String?
    public let idToken: String?
    public let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case scope
    }
}

/// RFC 6749 §5.2 error body.
struct OAuthErrorBody: Decodable {
    let error: String
}

/// Token, refresh and revocation calls of the public client `account-ios`
/// (no client secret; PKCE protects the code).
public struct OIDCClient: Sendable {
    private let config: AccountConfig
    private let http: any HTTPClient
    private let discovery: DiscoveryCache

    public init(config: AccountConfig, http: any HTTPClient, discovery: DiscoveryCache) {
        self.config = config
        self.http = http
        self.discovery = discovery
    }

    public func authorizationEndpoint() async throws -> URL {
        try await discovery.document().authorizationEndpoint
    }

    public func exchange(code: String, request: AuthorizationRequest) async throws -> TokenResponse {
        try await tokenCall([
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", request.redirectURI.absoluteString),
            ("client_id", AccountConfig.clientID),
            ("code_verifier", request.pkce.verifier),
        ])
    }

    public func refresh(_ refreshToken: String) async throws -> TokenResponse {
        try await tokenCall([
            ("grant_type", "refresh_token"),
            ("refresh_token", refreshToken),
            ("client_id", AccountConfig.clientID),
        ])
    }

    /// RFC 7009: revoking the refresh token ends the grant (and its access
    /// tokens) at the IdP. The endpoint answers 200 even for unknown tokens.
    public func revoke(refreshToken: String) async throws {
        guard let endpoint = try await discovery.document().revocationEndpoint else {
            throw AccountError.invalidConfiguration("revocation")
        }
        let request = URLRequest.form(endpoint, [
            ("token", refreshToken),
            ("token_type_hint", "refresh_token"),
            ("client_id", AccountConfig.clientID),
        ])
        let (_, response) = try await send(request)
        guard response.statusCode == 200 else {
            throw AccountError.server(status: response.statusCode, code: nil)
        }
    }

    private func tokenCall(_ fields: [(String, String)]) async throws -> TokenResponse {
        let endpoint = try await discovery.document().tokenEndpoint
        let (data, response) = try await send(.form(endpoint, fields))
        if response.statusCode == 200 {
            guard
                let tokens = try? JSONDecoder().decode(TokenResponse.self, from: data),
                tokens.tokenType.caseInsensitiveCompare("bearer") == .orderedSame
            else {
                throw AccountError.invalidResponse
            }
            return tokens
        }
        let code = (try? JSONDecoder().decode(OAuthErrorBody.self, from: data))?.error
        // invalid_grant and friends: the grant is gone for good. 5xx and
        // temporarily_unavailable may pass, so they keep the credentials.
        if (400..<500).contains(response.statusCode), code != nil, response.statusCode != 429 {
            throw AccountError.sessionEnded
        }
        throw AccountError.server(status: response.statusCode, code: code)
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await http.send(request)
        } catch {
            throw AccountError.wrap(error)
        }
    }
}
