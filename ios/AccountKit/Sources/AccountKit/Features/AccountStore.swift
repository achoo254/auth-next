import Foundation
import Observation

/// A short confirmation after an action succeeded.
public enum AccountNotice: Equatable, Sendable {
    case profileSaved
    case sessionRevoked
    case sessionsRevoked
    case deviceRevoked
    case appRevoked
    case linked(ProviderID)
    case unlinked(ProviderID)
}

/// State and actions of the signed-in screens. Reads come from one
/// `GET /api/account`; every action reloads it afterwards so the screens
/// always show what the IdP has.
@MainActor
@Observable
public final class AccountStore {
    public enum Phase: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(AccountError)
    }

    /// Same limit as the web form (`maxlength` 100).
    public static let maxNameLength = 100

    /// Kept after a failed reload, so an offline phone still shows the last
    /// known state under an "offline" banner.
    public private(set) var snapshot: AccountSnapshot?
    public private(set) var phase: Phase = .idle
    public private(set) var isWorking = false
    public var alert: AccountError?
    public var notice: AccountNotice?

    @ObservationIgnored private let api: AccountAPI
    @ObservationIgnored private let web: any WebAuthenticating
    @ObservationIgnored private let linkedURL: URL
    @ObservationIgnored private let reauthenticate: @MainActor () async throws -> String
    @ObservationIgnored private let accountDeleted: @MainActor () async -> Void

    public init(
        api: AccountAPI,
        web: any WebAuthenticating,
        linkedURL: URL,
        reauthenticate: @escaping @MainActor () async throws -> String,
        accountDeleted: @escaping @MainActor () async -> Void
    ) {
        self.api = api
        self.web = web
        self.linkedURL = linkedURL
        self.reauthenticate = reauthenticate
        self.accountDeleted = accountDeleted
    }

    public var isOffline: Bool { phase == .failed(.offline) }

    public func load() async {
        phase = .loading
        do {
            snapshot = try await api.snapshot()
            phase = .loaded
        } catch {
            phase = .failed(AccountError.wrap(error))
        }
    }

    /// Trims the name; an empty name clears it, like the web form.
    @discardableResult
    public func saveName(_ raw: String) async -> Bool {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count <= Self.maxNameLength else {
            alert = .invalidName
            return false
        }
        return await run(.profileSaved) { api in try await api.updateProfile(name: name) }
    }

    public func revokeSession(_ session: BrowserSession) async {
        await run(.sessionRevoked) { api in try await api.revokeSession(uid: session.uid) }
    }

    /// Other devices only; this phone signs out instead (Settings).
    public func revokeDevice(_ device: DeviceGrant) async {
        guard !device.current else { return }
        await run(.deviceRevoked) { api in try await api.revokeDevice(grantID: device.grantId) }
    }

    public func revokeApp(_ app: AuthorizedApp) async {
        await runSensitive(.appRevoked) { api, idToken in
            try await api.revokeApp(clientID: app.clientId, idToken: idToken)
        }
    }

    public func revokeAllSessions() async {
        await runSensitive(.sessionsRevoked) { api, idToken in
            try await api.revokeAllSessions(idToken: idToken)
        }
    }

    public func unlink(_ provider: ProviderID) async {
        await runSensitive(.unlinked(provider)) { api, idToken in
            try await api.unlink(provider: provider, idToken: idToken)
        }
    }

    /// Re-authenticates, asks the API for the link page, opens it in the
    /// browser sheet and reads the result from the `/ios/linked` redirect.
    public func link(_ provider: ProviderID) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let idToken = try await reauthenticate()
            let start = try await api.startLink(provider: provider, idToken: idToken)
            let callback = try await web.authenticate(url: start, callback: linkedURL)
            let outcome = LinkOutcome.parse(callback, expected: linkedURL)
            if outcome == .linked {
                notice = .linked(provider)
            } else {
                alert = .linkFailed(outcome)
            }
        } catch {
            present(error)
        }
        await load()
    }

    /// `typedUsername` must match the account, as on the web; the IdP
    /// checks it again. On success the app forgets the credentials.
    @discardableResult
    public func deleteAccount(typedUsername: String) async -> Bool {
        guard let username = snapshot?.account.username, Self.matches(typedUsername, username) else {
            alert = .usernameMismatch
            return false
        }
        guard !isWorking else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            let idToken = try await reauthenticate()
            try await api.deleteAccount(username: username, idToken: idToken)
        } catch {
            present(error)
            return false
        }
        await accountDeleted()
        return true
    }

    /// Same normalisation as the IdP: trimmed, lowercase, without a leading `@`.
    public static func matches(_ typed: String, _ username: String) -> Bool {
        var normalized = typed.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.hasPrefix("@") { normalized.removeFirst() }
        return !normalized.isEmpty && normalized == username
    }

    @discardableResult
    private func run(_ success: AccountNotice, _ operation: (AccountAPI) async throws -> Void) async -> Bool {
        guard !isWorking else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            try await operation(api)
        } catch {
            present(error)
            return false
        }
        notice = success
        await load()
        return true
    }

    private func runSensitive(
        _ success: AccountNotice, _ operation: (AccountAPI, String) async throws -> Void
    ) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let idToken = try await reauthenticate()
            try await operation(api, idToken)
        } catch {
            present(error)
            return
        }
        notice = success
        await load()
    }

    /// Cancelling is not an error, and an ended session is handled by the
    /// app model (back to the sign-in screen), so neither raises an alert.
    private func present(_ error: any Error) {
        let wrapped = AccountError.wrap(error)
        if wrapped == .cancelled || wrapped.endsSession { return }
        alert = wrapped
    }
}
