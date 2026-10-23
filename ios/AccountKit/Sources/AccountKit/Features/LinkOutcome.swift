import Foundation

/// How a provider link started from the app ended.
public enum LinkOutcome: String, Sendable, Equatable {
    case linked
    /// This provider account already belongs to another account here.
    case ownedByOther = "owned_by_other"
    case alreadyLinked = "already_linked"
    /// The one-time link state expired or the account changed meanwhile.
    case expired
    /// The provider refused or failed; also any value the app does not know.
    case failed

    /// A `result` value from the IdP; unknown values count as `.failed`.
    public init(result raw: String?) {
        self = raw.flatMap(LinkOutcome.init(rawValue:)) ?? .failed
    }
}

/// Where the browser sheet of a provider link ended:
/// `<issuer>/ios/linked?result=<value>[&ref=<ref>]`.
///
/// The provider step alone never links anything: on success the IdP answers
/// `result=pending&ref=<ref>`, and the app finishes the link with its own
/// bearer token (`POST …/link/complete`), so a link started in someone
/// else's browser cannot land on this account. The ref is a one-time value:
/// it is only held in memory for that call, never logged or stored.
public enum LinkCallback: Equatable, Sendable {
    case pending(ref: String)
    /// The provider step failed or was refused; nothing to complete.
    case finished(LinkOutcome)

    /// Parses the callback after checking it is the `/ios/linked` link.
    public static func parse(_ callback: URL, expected: URL) -> LinkCallback {
        guard
            callback.scheme == expected.scheme,
            callback.host() == expected.host(),
            callback.path() == expected.path(),
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        else {
            return .finished(.failed)
        }
        func value(_ name: String) -> String? {
            items.first(where: { $0.name == name })?.value
        }
        guard let result = value("result") else { return .finished(.failed) }
        if result == "pending" {
            guard let ref = value("ref"), !ref.isEmpty else { return .finished(.failed) }
            return .pending(ref: ref)
        }
        // Success is decided only by the completion call: a bare
        // `result=linked` in a URL anyone can open is not trusted.
        let outcome = LinkOutcome(result: result)
        return .finished(outcome == .linked ? .failed : outcome)
    }
}
