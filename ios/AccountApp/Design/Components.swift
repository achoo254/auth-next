import AccountKit
import SwiftUI

/// Every signed-in screen: error alerts, a confirmation banner after an
/// action, a progress overlay while one runs, and pull to refresh.
struct AccountScreen: ViewModifier {
    @Bindable var store: AccountStore

    func body(content: Content) -> some View {
        content
            .refreshable { await store.load() }
            .disabled(store.isWorking)
            .overlay {
                if store.isWorking {
                    ProgressView()
                        .controlSize(.large)
                        .padding(Spacing.xl)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.md))
                        .accessibilityLabel(Text("Working…"))
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let notice = store.notice {
                    NoticeBanner(text: notice.message)
                        .task(id: notice) {
                            try? await Task.sleep(for: .seconds(3))
                            if store.notice == notice { store.notice = nil }
                        }
                }
            }
            .animation(.default, value: store.notice)
            .alert(
                "Something went wrong",
                isPresented: Binding(get: { store.alert != nil }, set: { if !$0 { store.alert = nil } }),
                presenting: store.alert
            ) { _ in
                Button("OK", role: .cancel) {}
            } message: { error in
                Text(error.message)
            }
    }
}

extension View {
    func accountScreen(_ store: AccountStore) -> some View {
        modifier(AccountScreen(store: store))
    }
}

/// A confirmation that announces itself to VoiceOver.
struct NoticeBanner: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "checkmark.circle.fill")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Color.brandOnTone)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(Color.brandSuccess, in: Capsule())
            .padding(.bottom, Spacing.sm)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .onAppear {
                AccessibilityNotification.Announcement(text).post()
            }
    }
}

/// Shown above lists when the last reload failed but older data is shown.
struct StatusRow: View {
    let text: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label {
            Text(text).font(.subheadline)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Loading, failed-without-data, or the content.
struct LoadedContent<Content: View>: View {
    let store: AccountStore
    @ViewBuilder let content: (AccountSnapshot) -> Content

    var body: some View {
        if let snapshot = store.snapshot {
            content(snapshot)
        } else if case .failed(let error) = store.phase {
            ContentUnavailableView {
                Label(
                    error == .offline
                        ? LocalizedStringKey("You are offline")
                        : LocalizedStringKey("Could not load your account"),
                    systemImage: error == .offline ? "wifi.slash" : "exclamationmark.triangle"
                )
            } description: {
                Text(error.message)
            } actions: {
                Button("Try again") { Task { await store.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ProgressView("Loading…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Initial of the display name, else of the username, on the brand colour.
struct Avatar: View {
    let profile: AccountProfile

    private var initial: String {
        let source = profile.name?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? profile.username
        return source.first.map { String($0).localizedUppercase } ?? "?"
    }

    var body: some View {
        Text(initial)
            .font(.title.weight(.semibold))
            .foregroundStyle(Color.brandOnPrimary)
            .frame(width: 56, height: 56)
            .background(Color.brandPrimarySolid, in: Circle())
            .accessibilityHidden(true)
    }
}

extension ProviderID {
    var systemImage: String {
        switch self {
        case .apple: "apple.logo"
        case .google: "g.circle"
        case .github: "chevron.left.forwardslash.chevron.right"
        default: "person.badge.key"
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension Date {
    /// Short date and time in the person's locale.
    var shortDateTime: String { formatted(date: .abbreviated, time: .shortened) }
}
