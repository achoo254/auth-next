import AccountKit
import SwiftUI

/// Browser sessions of the IdP (web sign-ins). Signing out one is a write;
/// signing out all asks to sign in again, like the web.
struct SessionsView: View {
    let store: AccountStore
    @State private var pending: BrowserSession?
    @State private var confirmAll = false

    var body: some View {
        LoadedContent(store: store) { snapshot in
            List {
                if snapshot.sessions.isEmpty {
                    Text("No browser is signed in to your account.")
                        .foregroundStyle(Color.brandTextMuted)
                } else {
                    Section {
                        ForEach(snapshot.sessions) { session in
                            row(session)
                        }
                    } footer: {
                        Text("This app is not a browser session; it is listed under Devices.")
                    }
                    Section {
                        Button("Sign out all browser sessions", role: .destructive) { confirmAll = true }
                    }
                }
            }
            .accountScreen(store)
        }
        .navigationTitle("Browser sessions")
        .confirmationDialog(
            "Sign out this session?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible,
            presenting: pending
        ) { session in
            Button("Sign out", role: .destructive) {
                Task { await store.revokeSession(session) }
            }
        }
        .confirmationDialog("Sign out all browser sessions?", isPresented: $confirmAll, titleVisibility: .visible) {
            Button("Sign out all", role: .destructive) {
                Task { await store.revokeAllSessions() }
            }
        } message: {
            Text("You will be asked to sign in again to confirm.")
        }
    }

    private func row(_ session: BrowserSession) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(verbatim: describe(session)).font(.headline)
            if let loginAt = session.loginAt {
                Text("Signed in \(loginAt.shortDateTime)")
            }
            if let lastSeen = session.lastSeenAt {
                Text("Last active \(lastSeen.shortDateTime)")
            }
            if let ip = session.ip {
                Text(verbatim: "IP \(ip)")
            }
        }
        .font(.subheadline)
        .foregroundStyle(Color.brandTextMuted)
        .accessibilityElement(children: .combine)
        .swipeActions {
            Button("Sign out", role: .destructive) { pending = session }
        }
        .contextMenu {
            Button("Sign out", role: .destructive) { pending = session }
        }
        .accessibilityAction(named: Text("Sign out")) { pending = session }
    }

    private func describe(_ session: BrowserSession) -> String {
        switch (session.browser, session.os) {
        case let (browser?, os?): String(localized: "\(browser) on \(os)")
        case let (browser?, nil): browser
        case let (nil, os?): os
        case (nil, nil): String(localized: "Unknown browser")
        }
    }
}
