import AccountKit
import SwiftUI

/// Per-device grants: this phone, other phones, Tunelo CLI on a laptop...
/// This phone cannot be revoked here; Settings → Sign out does that.
struct DevicesView: View {
    let store: AccountStore
    @State private var pending: DeviceGrant?

    var body: some View {
        LoadedContent(store: store) { snapshot in
            List {
                if snapshot.devices.isEmpty {
                    Text("No device is signed in.")
                        .foregroundStyle(Color.brandTextMuted)
                } else {
                    ForEach(snapshot.devices) { device in
                        row(device)
                    }
                }
            }
            .accountScreen(store)
        }
        .navigationTitle("Devices")
        .confirmationDialog(
            "Sign out this device?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible,
            presenting: pending
        ) { device in
            Button("Sign out", role: .destructive) {
                Task { await store.revokeDevice(device) }
            }
        } message: { device in
            Text("\(device.appName) on that device will have to sign in again.")
        }
    }

    private func row(_ device: DeviceGrant) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(verbatim: "\(device.appName) · \(device.deviceName ?? String(localized: "Unnamed device"))")
                    .font(.headline)
                if device.current {
                    Text("This device")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.brandOnPrimary)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 2)
                        .background(Color.brandPrimarySolid, in: Capsule())
                }
            }
            Group {
                if let grantedAt = device.grantedAt {
                    Text("Signed in \(grantedAt.shortDateTime)")
                }
                if let expiresAt = device.expiresAt {
                    Text("Expires \(expiresAt.shortDateTime) unless used")
                }
            }
            .font(.subheadline)
            .foregroundStyle(Color.brandTextMuted)
            if !device.current {
                Button("Sign out", role: .destructive) { pending = device }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}
