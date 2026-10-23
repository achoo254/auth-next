import AccountKit
import UIKit
import UserNotifications

/// Builds the app model and receives what only an app delegate gets: the
/// APNs device token and taps on notifications.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// UI tests launch with this argument: no Keychain, no network.
    static let uiTestingArgument = "-ui-testing"

    let model: AppModel?

    override init() {
        model = Self.makeModel()
        super.init()
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard let push = model?.push else { return }
        Task { await push.deviceTokenReceived(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // Simulator or missing entitlement: notifications stay unavailable,
        // the rest of the app is unaffected.
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let kind = PushKind.from(userInfo: response.notification.request.content.userInfo) else { return }
        await MainActor.run { [weak self] in
            self?.model?.pendingDestination = kind.destination
        }
    }

    private static func makeModel() -> AppModel? {
        guard let config = try? AccountConfig.fromBundle() else { return nil }
        let locale = IdPLocale.from(preferredLocalization: Bundle.main.preferredLocalizations.first)
        let web = SystemWebAuthenticator()
        if ProcessInfo.processInfo.arguments.contains(uiTestingArgument) {
            let defaults = UserDefaults(suiteName: "ui-testing") ?? .standard
            defaults.removePersistentDomain(forName: "ui-testing")
            return AppModel.live(
                config: config, web: web, secureStore: InMemoryStore(), http: OfflineHTTPClient(),
                deviceName: nil, locale: locale, pushEnvironment: .sandbox, defaults: defaults
            )
        }
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
            .flatMap { try? Data(contentsOf: $0) }
        return AppModel.live(
            config: config,
            web: web,
            secureStore: KeychainStore(),
            http: URLSessionHTTPClient(),
            deviceName: UIDevice.current.name,
            locale: locale,
            pushEnvironment: APNsEnvironment.from(provisioningProfile: profile)
        )
    }
}

/// UI tests never reach the network.
private struct OfflineHTTPClient: HTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        throw URLError(.notConnectedToInternet)
    }
}
