import Foundation

/// How a provider link started from the app ended: the IdP redirects to
/// `<issuer>/ios/linked?result=<value>&provider=<id>` (purpose `link-app`).
public enum LinkOutcome: String, Sendable, Equatable {
    case linked
    /// This provider account already belongs to another account here.
    case ownedByOther = "owned_by_other"
    case alreadyLinked = "already_linked"
    /// The one-time link state expired or the account changed meanwhile.
    case expired
    /// The provider refused or failed; also any value the app does not know.
    case failed

    /// Parses the callback after checking it is the `/ios/linked` link.
    public static func parse(_ callback: URL, expected: URL) -> LinkOutcome {
        guard
            callback.scheme == expected.scheme,
            callback.host() == expected.host(),
            callback.path() == expected.path(),
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
            let raw = items.first(where: { $0.name == "result" })?.value
        else {
            return .failed
        }
        return LinkOutcome(rawValue: raw) ?? .failed
    }
}
