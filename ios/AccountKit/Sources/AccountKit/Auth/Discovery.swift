import Foundation

/// The parts of `/.well-known/openid-configuration` the app uses.
public struct DiscoveryDocument: Decodable, Sendable, Equatable {
    public let issuer: String
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let revocationEndpoint: URL?
    public let codeChallengeMethodsSupported: [String]?

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case revocationEndpoint = "revocation_endpoint"
        case codeChallengeMethodsSupported = "code_challenge_methods_supported"
    }

    /// OIDC Discovery §4.3: `issuer` must equal the issuer asked for. Every
    /// endpoint must be https on the issuer's host, so a tampered document
    /// cannot send the code or the refresh token somewhere else.
    public func validated(for config: AccountConfig) throws -> DiscoveryDocument {
        guard issuer == config.issuerString else { throw AccountError.issuerMismatch }
        let endpoints = [authorizationEndpoint, tokenEndpoint] + [revocationEndpoint].compactMap { $0 }
        for endpoint in endpoints where endpoint.scheme != "https" || endpoint.host() != config.host {
            throw AccountError.invalidConfiguration("endpoint")
        }
        if let methods = codeChallengeMethodsSupported, !methods.contains(PKCE.method) {
            throw AccountError.invalidConfiguration("pkce")
        }
        return self
    }
}

/// Loads discovery once per process; concurrent callers share one request
/// and a failure is not cached, so the next call tries again.
public actor DiscoveryCache {
    private let config: AccountConfig
    private let http: any HTTPClient
    private var cached: DiscoveryDocument?
    private var inFlight: Task<DiscoveryDocument, any Error>?

    public init(config: AccountConfig, http: any HTTPClient) {
        self.config = config
        self.http = http
    }

    public func document() async throws -> DiscoveryDocument {
        if let cached { return cached }
        if let inFlight { return try await inFlight.value }
        let task = Task { [config, http] in
            try await Self.fetch(config: config, http: http)
        }
        inFlight = task
        defer { inFlight = nil }
        let document = try await task.value
        cached = document
        return document
    }

    private static func fetch(config: AccountConfig, http: any HTTPClient) async throws -> DiscoveryDocument {
        var request = URLRequest(url: config.discoveryURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response): (Data, HTTPURLResponse)
        do {
            (data, response) = try await http.send(request)
        } catch {
            throw AccountError.wrap(error)
        }
        guard response.statusCode == 200 else {
            throw AccountError.server(status: response.statusCode, code: nil)
        }
        guard let document = try? JSONDecoder().decode(DiscoveryDocument.self, from: data) else {
            throw AccountError.invalidResponse
        }
        return try document.validated(for: config)
    }
}
