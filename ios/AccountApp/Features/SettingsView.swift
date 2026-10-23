import AccountKit
import LocalAuthentication
import SwiftUI
import UIKit

struct SettingsView: View {
    let model: AppModel
    let store: AccountStore
    @State private var confirmSignOut = false
    @State private var pushDenied = false

    private var lockReason: String { String(localized: "Confirm to change the app lock") }

    var body: some View {
        Form {
            Section {
                Toggle(isOn: Binding(
                    get: { model.lock.isEnabled },
                    set: { enabled in Task { await model.lock.setEnabled(enabled, reason: lockReason) } }
                )) {
                    Label(lockTitle, systemImage: "faceid")
                }
                .disabled(!model.lock.isAvailable)
                .accessibilityIdentifier("settings-app-lock")
            } footer: {
                Text(model.lock.isAvailable
                    ? LocalizedStringKey("Asks for Face ID or your passcode when you open the app.")
                    : LocalizedStringKey("Set a passcode on this iPhone to use the app lock."))
            }

            Section {
                Toggle(isOn: Binding(
                    get: { model.push.isEnabled },
                    set: { enabled in
                        Task {
                            if enabled {
                                pushDenied = !(await PushPermission.enable(model.push))
                            } else {
                                await PushPermission.disable(model.push)
                            }
                        }
                    }
                )) {
                    Label("Security notifications", systemImage: "bell.badge")
                }
                .accessibilityIdentifier("settings-push")
                if pushDenied {
                    Button("Allow notifications in Settings") { PushPermission.openSystemSettings() }
                }
            } footer: {
                Text("New sign-ins, sign-in method changes and removed access. Notifications never contain codes or links.")
            }

            Section {
                Button("Language") { PushPermission.openSystemSettings() }
                Link("Privacy policy", destination: model.config.privacyURL)
            } footer: {
                Text("The app follows the language set for it in the Settings app.")
            }

            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .accessibilityIdentifier("settings-sign-out")
                if store.snapshot?.canDelete == true {
                    NavigationLink(value: AccountDestination.deleteAccount) {
                        Text("Delete account").foregroundStyle(Color.brandError)
                    }
                }
            }

            Section {
                LabeledContent("Version", value: Self.version)
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog("Sign out of this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                Task { await model.signOut() }
            }
        }
    }

    private var lockTitle: LocalizedStringKey {
        switch LAContext().biometryTypeIfAvailable {
        case .touchID: "Lock with Touch ID"
        case .opticID: "Lock with Optic ID"
        case .faceID: "Lock with Face ID"
        default: "Lock with passcode"
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}

private extension LAContext {
    var biometryTypeIfAvailable: LABiometryType {
        _ = canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return biometryType
    }
}
