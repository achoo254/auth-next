import CryptoKit
import Foundation

extension Data {
    /// RFC 4648 §5 alphabet, no padding (PKCE, JWT segments).
    public func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public init?(base64URLEncoded text: String) {
        var base64 = text
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder == 1 { return nil }
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        self.init(base64Encoded: base64)
    }
}

/// Unguessable values for `state`, `nonce` and the PKCE verifier.
public enum RandomToken {
    /// `byteCount` bytes from the system CSPRNG, base64url encoded
    /// (32 bytes give the 43 characters RFC 7636 asks of a verifier).
    public static func make(byteCount: Int = 32) -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes).base64URLEncodedString()
    }
}

/// Proof Key for Code Exchange, S256 only (RFC 7636).
public struct PKCE: Sendable, Equatable {
    public static let method = "S256"
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        let digest = SHA256.hash(data: Data(verifier.utf8))
        challenge = Data(digest).base64URLEncodedString()
    }

    public static func generate() -> PKCE {
        PKCE(verifier: RandomToken.make())
    }
}
