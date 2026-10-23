import AccountKit
import SwiftUI

@main
struct AccountApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            if let model = delegate.model {
                RootView(model: model)
                    .tint(.brandPrimary)
            } else {
                ConfigurationErrorView()
            }
        }
    }
}

/// Only reachable with a broken build configuration (no issuer).
private struct ConfigurationErrorView: View {
    var body: some View {
        ContentUnavailableView(
            "The app is misconfigured",
            systemImage: "exclamationmark.triangle",
            description: Text("This build has no sign-in server. Install the app again from the App Store.")
        )
    }
}
