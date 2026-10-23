import Foundation

/// Every failure the app shows. Views map each case to a localized message
/// (`AccountApp/Design/ErrorMessage.swift`); the cases never carry tokens,
/// codes or URLs, so they are safe to log and to put on screen.
public enum AccountError: Error, Equatable, Sendable {
    // Connectivity
    case offline

    // Sign-in and tokens
    /// The person closed the sign-in sheet.
    case cancelled
    /// No credentials on this device.
    case signedOut
    /// The IdP no longer accepts the refresh token (signed out elsewhere,
    /// device revoked, 90-day cap, account deleted).
    case sessionEnded
    case stateMismatch
    case issuerMismatch
    case invalidCallback
    /// The IdP redirected back with an OAuth `error` code.
    case authorizationFailed(String)
    case invalidIDToken(String)
    /// The re-authentication signed in to a different account.
    case differentAccount
    /// The re-authentication's `auth_time` is missing or older than allowed.
    case reauthTooOld
    case invalidConfiguration(String)

    // /api/account
    case reauthRequired
    case notFound
    case lastSignInMethod
    case providerUnavailable
    case alreadyLinked
    case usernameMismatch
    case invalidName
    case rateLimited(retryAfter: Int?)
    case server(status: Int, code: String?)
    case invalidResponse

    // Linking a provider from the app (`/ios/linked?result=…`)
    case linkFailed(LinkOutcome)

    /// Errors after which the app returns to the sign-in screen.
    public var endsSession: Bool {
        self == .sessionEnded || self == .signedOut
    }
}

extension AccountError {
    /// URLSession failures that mean "no usable network right now".
    static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .timedOut,
        .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
        .dataNotAllowed, .internationalRoamingOff, .secureConnectionFailed,
    ]

    /// Maps transport errors to `.offline`, keeps `AccountError` as is and
    /// treats anything else as an invalid response.
    static func wrap(_ error: any Error) -> AccountError {
        if let known = error as? AccountError { return known }
        if let urlError = error as? URLError {
            if urlError.code == .cancelled { return .cancelled }
            return offlineCodes.contains(urlError.code) ? .offline : .invalidResponse
        }
        return .invalidResponse
    }
}
