import AccountKit
import SwiftUI

/// Link and unlink Google, GitHub and Apple. Both ask to sign in again;
/// the IdP refuses to unlink the last method that can still sign in.
struct SignInMethodsView: View {
    let store: AccountStore
    @State private var pendingUnlink: SignInProvider?

    var body: some View {
        LoadedContent(store: store) { snapshot in
            List {
                Section {
                    ForEach(snapshot.providers) { provider in
                        row(provider)
                    }
                } footer: {
                    Text("Linking or removing a method asks you to sign in again first.")
                }
            }
            .accountScreen(store)
        }
        .navigationTitle("Sign-in methods")
        .confirmationDialog(
            "Remove this sign-in method?",
            isPresented: Binding(get: { pendingUnlink != nil }, set: { if !$0 { pendingUnlink = nil } }),
            titleVisibility: .visible,
            presenting: pendingUnlink
        ) { provider in
            Button("Remove \(provider.provider.displayName)", role: .destructive) {
                Task { await store.unlink(provider.provider) }
            }
        } message: { provider in
            Text("You will no longer be able to sign in with \(provider.provider.displayName).")
        }
    }

    private func row(_ provider: SignInProvider) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label {
                Text(verbatim: provider.provider.displayName).font(.headline)
            } icon: {
                Image(systemName: provider.provider.systemImage)
            }
            status(provider)
                .font(.subheadline)
                .foregroundStyle(Color.brandTextMuted)
            if provider.linked, provider.canUnlink {
                Button("Remove", role: .destructive) { pendingUnlink = provider }
                    .buttonStyle(.bordered)
            } else if provider.canLink {
                Button("Link \(provider.provider.displayName)") {
                    Task { await store.link(provider.provider) }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    @ViewBuilder
    private func status(_ provider: SignInProvider) -> some View {
        if provider.linked {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: identity(provider) ?? String(localized: "Linked (details unknown)"))
                if let linkedAt = provider.linkedAt {
                    Text("Linked on \(linkedAt.shortDateTime)")
                }
                if !provider.canUnlink {
                    Text("Your only way to sign in, so it cannot be removed.")
                } else if !provider.enabled {
                    Text("Linked, but this method is turned off on the sign-in server.")
                }
            }
        } else if provider.enabled {
            Text("Not linked")
        } else {
            Text("Not available")
        }
    }

    /// "email · @login" as the web shows it.
    private func identity(_ provider: SignInProvider) -> String? {
        let parts = [provider.email, provider.login.map { "@\($0)" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
