import AppKit
import SwiftUI

/// First run — or a returning user who cleared their token in Settings. One sentence,
/// one field, one button — and an explicit pointer to where the token actually comes
/// from, because nothing else in the app can work until it's here.
///
/// Doubles as step 2 of `OnboardingWizard`, which is the only caller that passes
/// `onSaved`; used bare (as the plain `.needsToken` state) it defaults to `nil`.
///
/// Routes through `TrackerManager.connect(token:)` — the same verify-then-save flow a
/// `vibehub://connect` link or an installer handoff uses — so a pasted token is never
/// treated any differently from one that arrived some other way.
struct OnboardingView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    /// `viaKeyboard` is true when Return in the field submitted the token, so the
    /// wizard can advance without motion — a keyboard-driven step must not animate
    /// (N6). A click passes false and gets the ordinary transition.
    var onSaved: ((_ viaKeyboard: Bool) -> Void)? = nil

    @State private var token = ""
    @State private var isVerifying = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                // The real mark, not a system chevron (Lumi, first-start review).
                BrandMark(size: 15)
                Text("VibeHub").font(.system(size: 14, weight: .semibold))
            }

            Text("Paste your tracker token to see your activity here.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField("Tracker token", text: $token)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, design: .monospaced))
                .onSubmit { verify(viaKeyboard: true) }

            Button(isVerifying ? "Verifying\u{2026}" : "Verify") { verify(viaKeyboard: false) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isVerifying || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let username = tracker.connectedUsername {
                Text("Verified as \(username)").font(.system(size: 11)).foregroundStyle(.secondary)
            } else if let errorMessage {
                Text(errorMessage).font(.system(size: 11)).foregroundStyle(.secondary)
            }

            Divider().padding(.vertical, 2)

            // This is load-bearing copy — a first-run user genuinely cannot guess it —
            // so it earns more words than a banner would.
            Text("Tokens are minted on the web, under Settings → Tracker.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button("Open Settings → Tracker") {
                NSWorkspace.shared.open(settings.webUrl.appendingPathComponent("settings"))
            }
            .buttonStyle(.borderless)
            .font(.system(size: 11))
        }
    }

    private func verify(viaKeyboard: Bool) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isVerifying = true
        errorMessage = nil
        Task {
            let result = await tracker.connect(token: trimmed)
            isVerifying = false
            switch result {
            case .success:
                token = ""
                store.wake()
                onSaved?(viaKeyboard)
            case .failure(let error):
                errorMessage = error.errorDescription
            }
        }
    }
}
