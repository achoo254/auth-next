import AccountKit
import SwiftUI
import UserNotifications

/// Who is signed in and a row per area, with counts like the web overview.
struct OverviewView: View {
    let model: AppModel
    let store: AccountStore
    @State private var pushStatus: UNAuthorizationStatusBox = .unknown

    var body: some View {
        LoadedContent(store: store) { snapshot in
            List {
                Section {
                    header(snapshot.account)
                }
                statusSection(snapshot)
                if pushStatus == .notDetermined, !model.push.isEnabled {
                    Section {
                        pushPrompt
                    }
                }
                Section("Account") {
                    NavigationLink(value: AccountDestination.profile) {
                        Label("Profile", systemImage: "person")
                    }
                    NavigationLink(value: AccountDestination.signInMethods) {
                        Label("Sign-in methods", systemImage: "key")
                    }
                    .badge(snapshot.providers.filter(\.linked).count)
                }
                Section("Security") {
                    NavigationLink(value: AccountDestination.sessions) {
                        Label("Browser sessions", systemImage: "globe")
                    }
                    .badge(snapshot.sessions.count)
                    NavigationLink(value: AccountDestination.devices) {
                        Label("Devices", systemImage: "iphone")
                    }
                    .badge(snapshot.devices.count)
                }
                Section("Connections") {
                    NavigationLink(value: AccountDestination.apps) {
                        Label("Apps with access", systemImage: "square.grid.2x2")
                    }
                    .badge(snapshot.apps.count)
                    if snapshot.telegram.available {
                        telegramRow(snapshot.telegram)
                    }
                }
                Section {
                    NavigationLink(value: AccountDestination.settings) {
                        Label("Settings", systemImage: "gearshape")
                    }
                }
            }
            .accountScreen(store)
        }
        .navigationTitle("Account")
        .task { pushStatus = UNAuthorizationStatusBox(await PushPermission.status()) }
    }

    private func header(_ profile: AccountProfile) -> some View {
        HStack(spacing: Spacing.lg) {
            Avatar(profile: profile)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if let name = profile.name {
                    Text(name).font(.headline)
                }
                Text(verbatim: "@\(profile.username)")
                    .font(profile.name == nil ? .headline : .subheadline)
                    .foregroundStyle(profile.name == nil ? Color.brandText : Color.brandTextMuted)
                if let email = profile.email {
                    Text(verbatim: email)
                        .font(.subheadline)
                        .foregroundStyle(Color.brandTextMuted)
                    if let provider = profile.emailVerifiedBy {
                        Label("Verified by \(provider.displayName)", systemImage: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundStyle(Color.brandSuccess)
                    } else {
                        Label("Not verified", systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(Color.brandWarning)
                    }
                } else {
                    Text("No email")
                        .font(.subheadline)
                        .foregroundStyle(Color.brandTextMuted)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func statusSection(_ snapshot: AccountSnapshot) -> some View {
        if store.isOffline || snapshot.account.reclaimedEmail != nil {
            Section {
                if store.isOffline {
                    StatusRow(
                        text: String(localized: "You are offline. Showing the last loaded information."),
                        systemImage: "wifi.slash",
                        tint: .brandWarning
                    )
                }
                if let reclaimed = snapshot.account.reclaimedEmail {
                    StatusRow(
                        text: String(localized: "On \(reclaimed.at.shortDateTime), \(reclaimed.email) was taken back by the person who verified it."),
                        systemImage: "exclamationmark.triangle.fill",
                        tint: .brandWarning
                    )
                }
            }
        }
    }

    private var pushPrompt: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label("Security notifications", systemImage: "bell.badge")
                .font(.headline)
            Text("Get a notification when someone signs in, a sign-in method changes or access is removed.")
                .font(.subheadline)
                .foregroundStyle(Color.brandTextMuted)
            Button("Turn on notifications") {
                Task {
                    _ = await PushPermission.enable(model.push)
                    pushStatus = UNAuthorizationStatusBox(await PushPermission.status())
                }
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func telegramRow(_ telegram: TelegramStatus) -> some View {
        LabeledContent {
            if telegram.linked {
                Text(verbatim: telegram.username.map { "@\($0)" } ?? telegram.name ?? "")
            } else {
                Text("Not linked")
            }
        } label: {
            Label("Telegram", systemImage: "paperplane")
        }
        .accessibilityElement(children: .combine)
    }
}

/// Whether the overview should offer to turn notifications on: only while
/// the system has not asked yet.
enum UNAuthorizationStatusBox: Equatable {
    case unknown, notDetermined, decided

    init(_ status: UNAuthorizationStatus) {
        self = status == .notDetermined ? .notDetermined : .decided
    }
}
