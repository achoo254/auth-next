import Foundation

/// Where the app signs in and which API it talks to. One issuer per build:
/// the primary tenant (`ISSUER_HOST` in `Config/Base.xcconfig`).
public struct AccountConfig: Sendable, Equatable {
    /// The public native client of the IdP (`src/oidc/account-ios-client.ts`).
    public static let clientID = "account-ios"
    /// `account` is the scope `/api/account` requires; refresh tokens come
    /// without `offline_access` because the client is bound to the device.
    public static let scopes = ["openid", "profile", "email", "account"]
    /// Bundle key holding the issuer URL, filled from the xcconfig.
    public static let issuerInfoKey = "AccountIssuer"

    public let issuer: URL

    /// Accepts only an absolute `https` URL with a host and no query or
    /// fragment; a trailing `/` is dropped so `iss` compares exactly.
    public init(issuer raw: String) throws {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard
            let url = URL(string: text),
            url.scheme == "https",
            let host = url.host(), !host.isEmpty,
            url.query() == nil, url.fragment() == nil
        else {
            throw AccountError.invalidConfiguration("issuer")
        }
        issuer = url
    }

    public static func fromBundle(_ bundle: Bundle = .main) throws -> AccountConfig {
        guard let raw = bundle.object(forInfoDictionaryKey: issuerInfoKey) as? String else {
            throw AccountError.invalidConfiguration("issuer")
        }
        return try AccountConfig(issuer: raw)
    }

    /// `iss` as the IdP writes it: the issuer URL without a trailing slash.
    public var issuerString: String { issuer.absoluteString }
    public var host: String { issuer.host() ?? "" }

    public var discoveryURL: URL { issuer.appending(path: ".well-known/openid-configuration") }
    /// Universal link the sign-in ends on (`ASWebAuthenticationSession.Callback.https`).
    public var callbackURL: URL { issuer.appending(path: "ios/callback") }
    /// Universal link a provider link started from the app ends on.
    public var linkedURL: URL { issuer.appending(path: "ios/linked") }
    public var apiBaseURL: URL { issuer.appending(path: "api/account") }
    public var privacyURL: URL { issuer.appending(path: "privacy") }
}
