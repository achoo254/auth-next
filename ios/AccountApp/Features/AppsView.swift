import AccountKit
import SwiftUI

/// Apps the account signed in to through the browser. Removing access asks
/// to sign in again, like the web.
struct AppsView: View {
    let store: AccountStore
    @State private var pending: AuthorizedApp?

    var body: some View {
        LoadedContent(store: store) { snapshot in
            List {
                if snapshot.apps.isEmpty {
                    Text("No app has access to your account.")
                        .foregroundStyle(Color.brandTextMuted)
                } else {
                    ForEach(snapshot.apps) { app in
                        row(app)
                    }
                }
            }
            .accountScreen(store)
        }
        .navigationTitle("Apps with access")
        .confirmationDialog(
            "Remove access?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible,
            presenting: pending
        ) { app in
            Button("Remove access for \(app.name)", role: .destructive) {
                Task { await store.revokeApp(app) }
            }
        } message: { _ in
            Text("You will be asked to sign in again to confirm. The app loses access on every device.")
        }
    }

    private func row(_ app: AuthorizedApp) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(verbatim: app.name).font(.headline)
                if app.firstParty {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Color.brandPrimary)
                        .accessibilityLabel(Text("Our app"))
                }
            }
            if !app.redirectHosts.isEmpty {
                Text(verbatim: app.redirectHosts.joined(separator: ", "))
                    .font(.subheadline)
                    .foregroundStyle(Color.brandTextMuted)
            }
            if !app.scopes.isEmpty {
                Text("Can read: \(app.scopes.joined(separator: ", "))")
                    .font(.footnote)
                    .foregroundStyle(Color.brandTextMuted)
            }
            Button("Remove access", role: .destructive) { pending = app }
                .buttonStyle(.bordered)
        }
        .padding(.vertical, Spacing.xs)
    }
}
