import AccountKit
import UIKit
import UserNotifications

/// The system side of notifications: permission and APNs registration.
/// The app asks only when the person turns notifications on (after
/// sign-in), never at launch.
@MainActor
enum PushPermission {
    static func status() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Asks for permission if needed; on success registers with APNs, and
    /// the device token reaches `PushSync` through the app delegate.
    static func enable(_ push: PushSync) async -> Bool {
        let granted: Bool
        switch await status() {
        case .authorized, .provisional, .ephemeral:
            granted = true
        case .notDetermined:
            granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        default:
            granted = false
        }
        guard granted else { return false }
        await push.setEnabled(true)
        UIApplication.shared.registerForRemoteNotifications()
        return true
    }

    static func disable(_ push: PushSync) async {
        await push.setEnabled(false)
    }

    /// At launch while signed in: tokens can change, so register again.
    static func refreshRegistration(_ push: PushSync) async {
        guard push.isEnabled else { return }
        switch await status() {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        default:
            break
        }
    }

    static func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
