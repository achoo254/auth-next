import Foundation

/// A sign-in provider id. Known ones have constants; an id the app does not
/// know yet still decodes, so a new provider on the IdP never breaks the
/// whole screen.
public struct ProviderID: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let apple = ProviderID(rawValue: "apple")
    public static let google = ProviderID(rawValue: "google")
    public static let github = ProviderID(rawValue: "github")

    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    /// Brand names are not translated.
    public var displayName: String {
        switch self {
        case .apple: "Apple"
        case .google: "Google"
        case .github: "GitHub"
        default: rawValue.capitalized
        }
    }
}

/// `GET /api/account`: everything the account screens show, in one call.
/// Contract: `ios/contract/README.md`, fixtures `ios/contract/*.json`.
public struct AccountSnapshot: Decodable, Sendable, Equatable {
    public let account: AccountProfile
    public let providers: [SignInProvider]
    public let telegram: TelegramStatus
    public let sessions: [BrowserSession]
    public let devices: [DeviceGrant]
    public let apps: [AuthorizedApp]
    /// The tenant lets people delete their own account (ADR 0009).
    public let canDelete: Bool
}

public struct AccountProfile: Decodable, Sendable, Equatable {
    public let id: String
    public let username: String
    public let name: String?
    public let email: String?
    /// Who verified `email`; nil for an unverified address.
    public let emailVerifiedBy: ProviderID?
    public let picture: URL?
    public let createdAt: Date
    /// The unverified email this account lost to its verified owner.
    public let reclaimedEmail: ReclaimedEmail?
}

public struct ReclaimedEmail: Decodable, Sendable, Equatable {
    public let email: String
    public let at: Date
}

/// One row of "Sign-in methods", in the IdP's order (Apple, Google, GitHub).
public struct SignInProvider: Decodable, Sendable, Equatable, Identifiable {
    public let provider: ProviderID
    /// The IdP offers this provider right now.
    public let enabled: Bool
    public let linked: Bool
    /// What the provider vouched for when linked; nil for older links.
    public let email: String?
    public let login: String?
    public let linkedAt: Date?
    /// The IdP's own rule: another linked, enabled provider remains.
    public let canUnlink: Bool

    public var id: String { provider.rawValue }
    public var canLink: Bool { enabled && !linked }
}

public struct TelegramStatus: Decodable, Sendable, Equatable {
    /// The IdP has a Telegram bot configured.
    public let available: Bool
    public let linked: Bool
    public let username: String?
    public let name: String?
    public let linkedAt: Date?
}

/// An IdP browser session (the web sign-ins).
public struct BrowserSession: Decodable, Sendable, Equatable, Identifiable {
    public let uid: String
    public let loginAt: Date?
    public let lastSeenAt: Date?
    /// Labels the IdP derives from the User-Agent; nil when unknown.
    public let browser: String?
    public let os: String?
    public let ip: String?

    public var id: String { uid }
}

/// A per-device grant (this app on a phone, Chat mobile, Tunelo CLI...).
public struct DeviceGrant: Decodable, Sendable, Equatable, Identifiable {
    public let grantId: String
    public let clientId: String
    public let appName: String
    public let deviceName: String?
    public let grantedAt: Date?
    public let expiresAt: Date?
    /// The grant of the access token that made this request: this phone.
    public let current: Bool

    public var id: String { grantId }
}

/// An app with access to the account through the browser (grouped grants).
public struct AuthorizedApp: Decodable, Sendable, Equatable, Identifiable {
    public let clientId: String
    public let name: String
    public let firstParty: Bool
    public let redirectHosts: [String]
    public let scopes: [String]

    public var id: String { clientId }
}

/// `POST /api/account/providers/:provider/link` response.
public struct LinkStart: Decodable, Sendable, Equatable {
    public let url: URL
}

/// `POST /api/account/providers/:provider/link/complete` response.
struct LinkCompletion: Decodable {
    let result: String
}
