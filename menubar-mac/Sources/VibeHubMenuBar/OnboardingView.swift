import AppKit
import SwiftUI

/// First run. One sentence, one field, one button — and an explicit pointer to where the
/// token actually comes from, because nothing else in the app can work until it's here.
struct OnboardingView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings

    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: 13, weight: .medium))
                Text("VibeHub").font(.system(size: 14, weight: .semibold))
            }

            Text("Paste your tracker token to see your activity here.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField("Tracker token", text: $token)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12, design: .monospaced))
                .onSubmit(save)

            Button("Connect", action: save)
                .buttonStyle(.borderedProminent)
                .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Divider().padding(.vertical, 2)

            // This is load-bearing copy — a first-run user genuinely cannot guess it —
            // so it earns more words than a banner would.
            Text("Tokens are minted on the web, under Settings → Tracker.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button("Open Settings → Tracker") {
                NSWorkspace.shared.open(settings.baseURL.appendingPathComponent("settings"))
            }
            .buttonStyle(.borderless)
            .font(.system(size: 11))
        }
    }

    private func save() {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.saveToken(trimmed)
        token = ""
    }
}
