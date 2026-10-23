import AccountKit
import Foundation

extension AccountError {
    /// What the person reads. Never includes codes, tokens or URLs.
    var message: String {
        switch self {
        case .offline:
            String(localized: "You are offline. Check your connection and try again.")
        case .cancelled:
            String(localized: "Sign-in was cancelled.")
        case .signedOut, .sessionEnded:
            String(localized: "Your session has ended. Please sign in again.")
        case .stateMismatch, .issuerMismatch, .invalidCallback, .invalidIDToken:
            String(localized: "The sign-in could not be verified. Please try again.")
        case .authorizationFailed:
            String(localized: "Sign-in did not complete. Please try again.")
        case .differentAccount:
            String(localized: "You signed in to a different account. Confirm with the account you are using in this app.")
        case .reauthTooOld, .reauthRequired:
            String(localized: "Please confirm it's you again, then retry.")
        case .invalidConfiguration:
            String(localized: "The sign-in server is not set up correctly. Try again later.")
        case .notFound:
            String(localized: "It is no longer there. The list has been refreshed.")
        case .lastSignInMethod:
            String(localized: "This is your only way to sign in. Link another method before removing it.")
        case .providerUnavailable:
            String(localized: "This sign-in method is not available right now.")
        case .alreadyLinked:
            String(localized: "This sign-in method is already linked.")
        case .usernameMismatch:
            String(localized: "The username does not match.")
        case .invalidName:
            String(localized: "The name can be at most 100 characters.")
        case .rateLimited:
            String(localized: "Too many attempts. Wait a moment and try again.")
        case .server, .invalidResponse:
            String(localized: "Something went wrong on the server. Try again later.")
        case .linkFailed(let outcome):
            outcome.message
        }
    }
}

extension LinkOutcome {
    var message: String {
        switch self {
        case .linked:
            String(localized: "Linked.")
        case .ownedByOther:
            String(localized: "That account is already linked to another account here.")
        case .alreadyLinked:
            String(localized: "This sign-in method is already linked.")
        case .expired:
            String(localized: "The link request expired. Please try again.")
        case .failed:
            String(localized: "Linking did not complete. Please try again.")
        }
    }
}

extension AccountNotice {
    var message: String {
        switch self {
        case .profileSaved: String(localized: "Profile saved.")
        case .sessionRevoked: String(localized: "Session signed out.")
        case .sessionsRevoked: String(localized: "All browser sessions signed out.")
        case .deviceRevoked: String(localized: "Device signed out.")
        case .appRevoked: String(localized: "Access removed.")
        case .linked(let provider): String(localized: "\(provider.displayName) linked.")
        case .unlinked(let provider): String(localized: "\(provider.displayName) unlinked.")
        }
    }
}
