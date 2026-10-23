import AccountKit
import SwiftUI

/// Signed in: the overview and everything reachable from it. A tapped
/// notification sets `pendingDestination`, which opens its screen.
struct MainView: View {
    let model: AppModel
    let store: AccountStore
    @State private var path: [AccountDestination] = []

    var body: some View {
        NavigationStack(path: $path) {
            OverviewView(model: model, store: store)
                .navigationDestination(for: AccountDestination.self) { destination in
                    screen(for: destination)
                }
        }
        .task {
            await store.load()
            await PushPermission.refreshRegistration(model.push)
        }
        .onChange(of: model.pendingDestination, initial: true) { _, destination in
            guard let destination else { return }
            path = [destination]
            model.pendingDestination = nil
            Task { await store.load() }
        }
    }

    @ViewBuilder
    private func screen(for destination: AccountDestination) -> some View {
        switch destination {
        case .profile: ProfileView(store: store)
        case .signInMethods: SignInMethodsView(store: store)
        case .sessions: SessionsView(store: store)
        case .devices: DevicesView(store: store)
        case .apps: AppsView(store: store)
        case .settings: SettingsView(model: model, store: store)
        case .deleteAccount: DeleteAccountView(store: store)
        }
    }
}
