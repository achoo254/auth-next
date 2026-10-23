import AccountKit
import SwiftUI

/// Sign-in or the account, with the privacy cover and the app lock on top.
struct RootView: View {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            switch model.phase {
            case .launching:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.brandBackground)
            case .signedOut(let reason):
                SignInView(model: model, reason: reason)
            case .signedIn:
                if let store = model.account {
                    MainView(model: model, store: store)
                }
            }
            if model.phase == .signedIn {
                if model.lock.isLocked {
                    LockView(lock: model.lock)
                } else if model.lock.isCovered {
                    PrivacyCover()
                }
            }
        }
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: model.lock.sceneBecameActive()
            case .inactive: model.lock.sceneResignedActive()
            case .background: model.lock.sceneEnteredBackground()
            @unknown default: break
            }
        }
    }
}

/// Covers account details in the app switcher and while inactive.
private struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Color.brandBackground.ignoresSafeArea()
            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 64))
                .foregroundStyle(Color.brandPrimary)
                .accessibilityHidden(true)
        }
    }
}

private struct LockView: View {
    let lock: AppLock

    private var reason: String { String(localized: "Unlock the Account app") }

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: "lock.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.brandPrimary)
                .accessibilityHidden(true)
            Text("Account is locked")
                .font(.title2.weight(.semibold))
            Button {
                Task { await lock.unlock(reason: reason) }
            } label: {
                Text("Unlock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, Spacing.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.brandBackground)
        .task { await lock.unlock(reason: reason) }
    }
}
