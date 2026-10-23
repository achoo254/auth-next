import Foundation

/// One authorization code request: its own state, nonce and PKCE verifier.
/// `prompt=login` makes it a re-authentication (fresh `auth_time`).
public struct AuthorizationRequest: Sendable, Equatable {
    public let state: String
    public let nonce: String
    public let pkce: PKCE
    public let redirectURI: URL
    public let prompt: String?
    public let deviceName: String?
    public let uiLocale: String?

    public init(
        redirectURI: URL,
        prompt: String? = nil,
        deviceName: String? = nil,
        uiLocale: String? = nil,
        state: String = RandomToken.make(),
        nonce: String = RandomToken.make(),
        pkce: PKCE = .generate()
    ) {
        self.redirectURI = redirectURI
        self.prompt = prompt
        self.deviceName = deviceName.flatMap(DeviceName.sanitized)
        self.uiLocale = uiLocale
        self.state = state
        self.nonce = nonce
        self.pkce = pkce
    }

    public func url(endpoint: URL) -> URL {
        var items = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: AccountConfig.clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: AccountConfig.scopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: PKCE.method),
        ]
        if let prompt { items.append(URLQueryItem(name: "prompt", value: prompt)) }
        if let deviceName { items.append(URLQueryItem(name: "device_name", value: deviceName)) }
        if let uiLocale { items.append(URLQueryItem(name: "ui_locales", value: uiLocale)) }
        // URLComponents leaves "+" alone in query values; the server reads
        // it as a space, so encode it explicitly.
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.percentEncodedQueryItems = items.map { item in
            URLQueryItem(name: item.name, value: Self.queryEscape(item.value ?? ""))
        }
        return components?.url ?? endpoint
    }

    /// The `code` of a callback URL after checking it ends on our redirect,
    /// carries our `state` and, when present, the right `iss` (RFC 9207).
    public func authorizationCode(from callback: URL, issuer: String) throws -> String {
        guard
            callback.scheme == redirectURI.scheme,
            callback.host() == redirectURI.host(),
            callback.path() == redirectURI.path(),
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        else {
            throw AccountError.invalidCallback
        }
        func value(_ name: String) -> String? {
            items.first(where: { $0.name == name })?.value
        }
        if let iss = value("iss"), iss != issuer { throw AccountError.issuerMismatch }
        guard value("state") == state else { throw AccountError.stateMismatch }
        if let error = value("error") {
            throw error == "access_denied" ? AccountError.cancelled : AccountError.authorizationFailed(error)
        }
        guard let code = value("code"), !code.isEmpty else { throw AccountError.invalidCallback }
        return code
    }

    private static let queryAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    private static func queryEscape(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: queryAllowed) ?? ""
    }
}

/// The `device_name` authorize parameter: the IdP accepts letters, digits,
/// space and `._'()-`, at most 64 characters (`src/interactions/device-info.ts`).
public enum DeviceName {
    private static let punctuation = Set(" ._'()-".unicodeScalars)

    public static func sanitized(_ raw: String) -> String? {
        let scalars = raw.precomposedStringWithCanonicalMapping.unicodeScalars.filter { scalar in
            punctuation.contains(scalar) || isLetterOrNumber(scalar)
        }
        let cleaned = String(String.UnicodeScalarView(scalars))
            .trimmingCharacters(in: .whitespaces)
        let limited = String(cleaned.unicodeScalars.prefix(64).map(Character.init))
            .trimmingCharacters(in: .whitespaces)
        return limited.isEmpty ? nil : limited
    }

    private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }
}
