import AccountKit
import SwiftUI

/// The only screen before sign-in. The IdP page that opens offers Google,
/// GitHub and Apple; the app never sees a password.
struct SignInView: View {
    let model: AppModel
    let reason: SignedOutReason?

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                Image(systemName: "person.crop.circle.badge.checkmark")
                    .font(.system(size: 72))
                    .foregroundStyle(Color.brandPrimary)
                    .accessibilityHidden(true)
                    .padding(.top, Spacing.xxl)

                VStack(spacing: Spacing.sm) {
                    Text("Account")
                        .font(.largeTitle.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text("Manage your profile, sign-in methods, sessions and devices, and get notified about security events.")
                        .font(.body)
                        .foregroundStyle(Color.brandTextMuted)
                        .multilineTextAlignment(.center)
                }

                if let reason {
                    StatusRow(
                        text: reason == .accountDeleted
                            ? String(localized: "Your account has been deleted.")
                            : String(localized: "Your session has ended. Please sign in again."),
                        systemImage: reason == .accountDeleted ? "checkmark.circle.fill" : "info.circle.fill",
                        tint: reason == .accountDeleted ? .brandSuccess : .brandInfo
                    )
                    .padding(Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.brandSurface, in: RoundedRectangle(cornerRadius: Radius.md))
                }

                Button {
                    Task { await model.signIn() }
                } label: {
                    Group {
                        if model.isSigningIn {
                            ProgressView()
                        } else {
                            Text("Sign in")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.isSigningIn)
                .accessibilityIdentifier("sign-in")
                .accessibilityHint(Text("Opens the sign-in page with Google, GitHub or Apple."))

                if let error = model.signInError {
                    Text(error.message)
                        .font(.callout)
                        .foregroundStyle(Color.brandError)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("sign-in-error")
                }

                Link("Privacy policy", destination: model.config.privacyURL)
                    .font(.footnote)
            }
            .padding(.horizontal, Spacing.xl)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandBackground)
    }
}
