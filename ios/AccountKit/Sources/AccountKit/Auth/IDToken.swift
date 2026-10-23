import Foundation

/// Claims of an ID token the app reads. The token comes straight from the
/// token endpoint over TLS, so the app checks claims, not the signature
/// (OIDC Core §3.1.3.7, item 6); the API verifies the signature itself
/// when the token is sent back for a sensitive action.
public struct IDTokenClaims: Decodable, Sendable, Equatable {
    public let iss: String
    public let sub: String
    public let aud: [String]
    public let exp: Date
    public let iat: Date?
    public let nonce: String?
    public let authTime: Date?

    enum CodingKeys: String, CodingKey {
        case iss, sub, aud, exp, iat, nonce
        case authTime = "auth_time"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        iss = try container.decode(String.self, forKey: .iss)
        sub = try container.decode(String.self, forKey: .sub)
        if let single = try? container.decode(String.self, forKey: .aud) {
            aud = [single]
        } else {
            aud = try container.decode([String].self, forKey: .aud)
        }
        exp = Date(timeIntervalSince1970: try container.decode(Double.self, forKey: .exp))
        iat = try container.decodeIfPresent(Double.self, forKey: .iat).map(Date.init(timeIntervalSince1970:))
        nonce = try container.decodeIfPresent(String.self, forKey: .nonce)
        authTime = try container.decodeIfPresent(Double.self, forKey: .authTime)
            .map(Date.init(timeIntervalSince1970:))
    }

    /// The payload of a compact JWS, without verifying it.
    public static func decode(_ jwt: String) throws -> IDTokenClaims {
        let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let payload = Data(base64URLEncoded: String(parts[1])) else {
            throw AccountError.invalidIDToken("format")
        }
        do {
            return try JSONDecoder().decode(IDTokenClaims.self, from: payload)
        } catch {
            throw AccountError.invalidIDToken("claims")
        }
    }

    /// OIDC Core §3.1.3.7: issuer, audience, nonce and expiry, with a small
    /// allowance for clock skew between the phone and the IdP.
    public func validate(issuer: String, nonce expectedNonce: String, now: Date, leeway: TimeInterval = 120) throws {
        guard iss == issuer else { throw AccountError.invalidIDToken("iss") }
        guard aud.contains(AccountConfig.clientID) else { throw AccountError.invalidIDToken("aud") }
        guard nonce == expectedNonce else { throw AccountError.invalidIDToken("nonce") }
        guard exp.addingTimeInterval(leeway) > now else { throw AccountError.invalidIDToken("exp") }
    }

    /// A re-authentication counts only if the person signed in within
    /// `maxAge` (the API allows 10 minutes; the app keeps a margin).
    public func isFresh(now: Date, maxAge: TimeInterval) -> Bool {
        guard let authTime else { return false }
        return now.timeIntervalSince(authTime) <= maxAge
    }
}
