import Foundation

/// APNs host the device token belongs to. Builds signed for development
/// (run from Xcode) get sandbox tokens; TestFlight and App Store builds get
/// production tokens. The IdP keeps it per token because a sandbox token
/// sent to the production host fails with `BadDeviceToken`.
public enum APNsEnvironment: String, Sendable, Equatable {
    case sandbox
    case production

    /// Reads `aps-environment` from the embedded provisioning profile.
    /// App Store builds carry no profile, which means production.
    public static func from(provisioningProfile data: Data?) -> APNsEnvironment {
        guard
            let data,
            let text = String(data: data, encoding: .isoLatin1),
            let start = text.range(of: "<?xml"),
            let end = text.range(of: "</plist>", range: start.lowerBound..<text.endIndex),
            let plistData = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
            let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any],
            let value = entitlements["aps-environment"] as? String
        else {
            return .production
        }
        return value == "development" ? .sandbox : .production
    }
}

/// Body of `PUT /api/account/push-device`.
public struct PushDeviceRegistration: Sendable, Equatable {
    /// The APNs device token as lowercase hex.
    public let token: String
    public let environment: APNsEnvironment
    /// IdP locale (`en`, `vi`, `zh-CN`) the notifications are written in.
    public let locale: String

    public init(deviceToken: Data, environment: APNsEnvironment, locale: String) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        self.environment = environment
        self.locale = locale
    }

    var body: [String: String] {
        ["token": token, "environment": environment.rawValue, "locale": locale]
    }
}

/// The security events the IdP pushes (phase 03, `PushKind`), sent as the
/// custom top-level key `kind` of the APNs payload.
public enum PushKind: String, Sendable, CaseIterable {
    case newSignIn = "new-sign-in"
    case providerLinked = "provider-linked"
    case providerUnlinked = "provider-unlinked"
    case emailReclaimed = "email-reclaimed"
    case accessRevoked = "access-revoked"

    /// The screen a tapped notification opens.
    public var destination: AccountDestination {
        switch self {
        case .newSignIn: .sessions
        case .accessRevoked: .devices
        case .providerLinked, .providerUnlinked: .signInMethods
        case .emailReclaimed: .profile
        }
    }

    public static func from(userInfo: [AnyHashable: Any]) -> PushKind? {
        (userInfo["kind"] as? String).flatMap(PushKind.init(rawValue:))
    }
}

/// Screens reachable from the overview, a notification or a deep link.
public enum AccountDestination: String, Hashable, Sendable, CaseIterable {
    case profile
    case signInMethods
    case sessions
    case devices
    case apps
    case settings
    case deleteAccount
}

/// The IdP locale for the app's current language: every Chinese variant is
/// `zh-CN`, unknown languages fall back to English like the IdP does.
public enum IdPLocale {
    public static func from(preferredLocalization: String?) -> String {
        let primary = (preferredLocalization ?? "en").lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first
        switch primary {
        case "vi": return "vi"
        case "zh": return "zh-CN"
        default: return "en"
        }
    }
}
