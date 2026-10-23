import Foundation
import Security
import Synchronization

/// What the app keeps between launches. The ID token is not kept: it is
/// only ever sent once, right after a re-authentication.
public struct Credentials: Codable, Sendable, Equatable {
    public var accessToken: String
    public var accessTokenExpiresAt: Date
    public var refreshToken: String
    /// `sub` of the signed-in account.
    public var accountID: String

    public init(accessToken: String, accessTokenExpiresAt: Date, refreshToken: String, accountID: String) {
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
        self.accountID = accountID
    }
}

/// One secret blob. The live implementation is the Keychain.
public protocol SecureStore: Sendable {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func delete() throws
}

public struct KeychainError: Error, Equatable, Sendable {
    public let status: OSStatus
}

/// A generic-password item readable after the first unlock since boot and
/// never leaving this device (no backup, no iCloud Keychain). It is not
/// bound to Face ID: refresh must keep working while the app is locked.
public struct KeychainStore: SecureStore {
    private let service: String
    private let account: String

    public init(service: String = "com.hoandat.account.credentials", account: String = "default") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public func read() throws -> Data? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        default: throw KeychainError(status: status)
        }
    }

    public func write(_ data: Data) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainError(status: update) }
        let add = SecItemAdd(baseQuery.merging(attributes) { $1 } as CFDictionary, nil)
        guard add == errSecSuccess else { throw KeychainError(status: add) }
    }

    public func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

/// For tests and UI tests: nothing touches the Keychain.
public final class InMemoryStore: SecureStore {
    private let data: Mutex<Data?>

    public init(_ initial: Data? = nil) {
        data = Mutex(initial)
    }

    public func read() throws -> Data? { data.withLock { $0 } }
    public func write(_ value: Data) throws { data.withLock { $0 = value } }
    public func delete() throws { data.withLock { $0 = nil } }
}

/// Credentials as JSON inside a `SecureStore`. Unreadable content is
/// removed rather than kept around, so the app falls back to signing in.
public struct TokenStore: Sendable {
    private let secure: any SecureStore

    public init(secure: any SecureStore) {
        self.secure = secure
    }

    public func load() throws -> Credentials? {
        guard let data = try secure.read() else { return nil }
        guard let credentials = try? JSONDecoder().decode(Credentials.self, from: data) else {
            try secure.delete()
            return nil
        }
        return credentials
    }

    public func save(_ credentials: Credentials) throws {
        try secure.write(JSONEncoder().encode(credentials))
    }

    public func clear() throws {
        try secure.delete()
    }
}
