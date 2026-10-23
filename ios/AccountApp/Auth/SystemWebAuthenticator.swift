import AccountKit
import AuthenticationServices
import UIKit

/// `ASWebAuthenticationSession` with an https universal-link callback
/// (only the app owning the domain receives it) and an ephemeral browser
/// session: no cookies shared with Safari, so signing out here is clean.
@MainActor
final class SystemWebAuthenticator: NSObject, WebAuthenticating, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, callback: URL) async throws -> URL {
        guard let host = callback.host() else { throw AccountError.invalidConfiguration("callback") }
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .https(host: host, path: callback.path())
            ) { [weak self] result, error in
                if let result {
                    continuation.resume(returning: result)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: AccountError.cancelled)
                } else {
                    continuation.resume(throwing: AccountError.authorizationFailed("browser"))
                }
                Task { @MainActor in self?.session = nil }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: AccountError.authorizationFailed("start"))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        return window ?? ASPresentationAnchor()
    }
}
