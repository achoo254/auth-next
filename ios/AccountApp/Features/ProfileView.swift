import AccountKit
import SwiftUI

struct ProfileView: View {
    let store: AccountStore
    @State private var name = ""
    @State private var edited = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        LoadedContent(store: store) { snapshot in
            Form {
                Section {
                    TextField("Display name", text: $name)
                        .textContentType(.name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .onChange(of: name) { edited = true }
                        .accessibilityIdentifier("profile-name")
                } header: {
                    Text("Name")
                } footer: {
                    Text("Shown to the apps you sign in to. Leave empty to use your username.")
                }
                Section("Details") {
                    LabeledContent("Username") { Text(verbatim: "@\(snapshot.account.username)") }
                    LabeledContent("Email") {
                        if let email = snapshot.account.email {
                            Text(verbatim: email)
                        } else {
                            Text("No email")
                        }
                    }
                    LabeledContent("Created", value: snapshot.account.createdAt.shortDateTime)
                }
                Section {
                    Button("Save", action: save)
                        .disabled(!edited || name.count > AccountStore.maxNameLength)
                        .accessibilityIdentifier("profile-save")
                }
            }
            .onAppear {
                if !edited { name = snapshot.account.name ?? "" }
                edited = false
            }
            .accountScreen(store)
        }
        .navigationTitle("Profile")
    }

    private func save() {
        nameFocused = false
        Task {
            if await store.saveName(name) { edited = false }
        }
    }
}
