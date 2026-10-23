import Foundation

/// JSON of `/api/account`: camelCase keys, dates as ISO 8601 strings the way
/// JavaScript's `Date.prototype.toISOString` writes them (with milliseconds);
/// a date without fractional seconds is accepted as well.
public enum APICoding {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = parseDate(text) { return date }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Expected an ISO 8601 date"
            )
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static func parseDate(_ text: String) -> Date? {
        let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        if let date = try? withFraction.parse(text) { return date }
        return try? Date.ISO8601FormatStyle().parse(text)
    }
}

/// Error body of every `/api/account` response that is not 2xx:
/// `{"error": "<code>", "error_description": "<text>"}`.
public struct APIErrorBody: Decodable, Sendable, Equatable {
    public let error: String
    public let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

extension AccountError {
    /// The error the app shows for an HTTP status and an optional error
    /// body. Codes listed in `ios/contract/README.md` win over the status.
    public static func fromAPI(status: Int, body: APIErrorBody?, retryAfter: String?) -> AccountError {
        switch body?.error {
        case "invalid_token": return .sessionEnded
        case "reauth_required": return .reauthRequired
        case "not_found": return .notFound
        case "last_sign_in_method": return .lastSignInMethod
        case "provider_unavailable": return .providerUnavailable
        case "already_linked": return .alreadyLinked
        case "username_mismatch": return .usernameMismatch
        case "invalid_name": return .invalidName
        case "rate_limited": return .rateLimited(retryAfter: retryAfter.flatMap { Int($0) })
        default: break
        }
        switch status {
        case 401: return .sessionEnded
        case 404: return .notFound
        case 429: return .rateLimited(retryAfter: retryAfter.flatMap { Int($0) })
        default: return .server(status: status, code: body?.error)
        }
    }
}
