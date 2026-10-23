import AccountKit
import SwiftUI

/// Account deletion (App Store 5.1.1(v), ADR 0009): the consequences, the
/// username typed again, a fresh sign-in, then `DELETE /api/account`.
/// Deletion is immediate; the app then shows "deleted" on the sign-in screen.
struct DeleteAccountView: View {
    let store: AccountStore
    @State private var typed = ""
    @State private var confirm = false

    var body: some View {
        LoadedContent(store: store) { snapshot in
            Form {
                Section {
                    Label("Deleting your account cannot be undone.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.brandError)
                        .font(.headline)
                    consequence("You can no longer sign in with this account to Localman, Tunelo, Chat, Scribe or any other app that uses it.")
                    consequence("Your profile, linked sign-in methods, sessions, devices and app access are deleted right away, and Apple sign-in is revoked.")
                    consequence("Data inside the other apps (projects, messages, notes) is not deleted by this. Domains you own keep following your Google or GitHub account.")
                    consequence("Signing in again later with the same Google, GitHub or Apple account creates a new, empty account.")
                }
                Section {
                    TextField(snapshot.account.username, text: $typed)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("delete-username")
                } header: {
                    Text("Type your username to confirm")
                } footer: {
                    Text("You will be asked to sign in again before the account is deleted.")
                }
                Section {
                    Button("Delete account", role: .destructive) { confirm = true }
                        .disabled(!AccountStore.matches(typed, snapshot.account.username))
                        .accessibilityIdentifier("delete-confirm")
                }
            }
            .accountScreen(store)
            .confirmationDialog("Delete your account now?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) {
                    Task { await store.deleteAccount(typedUsername: typed) }
                }
            }
        }
        .navigationTitle("Delete account")
    }

    private func consequence(_ text: LocalizedStringKey) -> some View {
        Label {
            Text(text).font(.subheadline)
        } icon: {
            Image(systemName: "minus.circle").foregroundStyle(Color.brandTextMuted)
        }
    }
}
