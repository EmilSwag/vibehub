import AppKit
import SwiftUI

/// Rendered inside the popover rather than in a separate `Settings` scene: opening a
/// settings window from an `LSUIElement` menu-bar app needs a private selector that
/// changed name between macOS 13 and 14. Staying in the popover avoids that entirely.
struct SettingsView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    var onClose: () -> Void

    @State private var token = ""
    @State private var isVerifying = false
    @State private var savedNote: String?
    @State private var launchError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Settings").font(.system(size: 14, weight: .semibold))
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 5) {
                SectionLabel(text: "Tracker token")
                SecureField(store.token == nil ? "Not set" : "Replace token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12, design: .monospaced))
                    .onSubmit(saveToken)
                HStack(spacing: 8) {
                    Button(isVerifying ? "Verifying\u{2026}" : "Save", action: saveToken)
                        .disabled(isVerifying || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if store.token != nil {
                        // N1(b): "Clear" used to delete the Keychain entry and nothing
                        // else, leaving a credentialed daemon running under a supervisor
                        // that would restart it at every login — the app forgot the
                        // account, the machine did not. Sign out is the whole operation:
                        // stop the daemon, release this device's connection receipt, drop
                        // the tracker's own config, remove the LaunchAgent and the login
                        // item, then clear the Keychain.
                        Button(tracker.isBusy ? "Signing out\u{2026}" : "Sign out") {
                            Task {
                                await tracker.signOut()
                                token = ""
                                savedNote = "Signed out on this Mac."
                                store.wake()
                            }
                        }
                        .disabled(tracker.isBusy)
                    }
                }
                .buttonStyle(.bordered)
                .font(.system(size: 12))
                if let savedNote {
                    Text(savedNote).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }

            Divider()

            Toggle("Show today's time in the menu bar", isOn: $settings.showTimeInBar)
                .font(.system(size: 12))
                .toggleStyle(.switch)
                .controlSize(.small)

            // Lumi: "Track at login" silently also flipped "Launch at login", so turning
            // one on moved a switch the user never touched and the pair could disagree.
            // They are one decision — "start with my Mac" — and are now one switch that
            // says what it does. `TrackerManager.enableTrackAtLogin`/`disable…` own both
            // halves (the tracker's LaunchAgent and the app's login registration), which
            // is also what makes Off durable (FC5).
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Toggle("Start with my Mac", isOn: Binding(
                        get: { tracker.isTrackAtLoginEnabled },
                        set: { enabled in Task { await setTrackAtLogin(enabled) } }
                    ))
                    .font(.system(size: 12))
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .disabled(tracker.isBusy || store.token == nil)

                    // Lumi: there was no in-flight state at all — `launchctl bootstrap`
                    // plus a `login` round trip is seconds of nothing happening.
                    if tracker.isBusy {
                        ProgressView().controlSize(.small)
                    }
                }

                Text("Runs the tracker and reopens VibeHub after a reboot, even while the app is closed. Turning this off keeps it off \u{2014} including across updates.")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)

                if store.token == nil {
                    Text("Add a token above first.")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                // Lumi: errors were styled as ordinary body text and read as description.
                // A failure gets a symbol and full-strength weight so it is distinguishable
                // from the tertiary explanatory line directly above it — no hue, because
                // presence is the only colour this product uses (emil design-eng, strict
                // monochrome; the same reason the done-tick in onboarding is not green).
                if let message = tracker.lastActionError ?? tracker.launchAtLoginError ?? launchError {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 5) {
                SectionLabel(text: "Island")
                Picker("", selection: $settings.islandMode) {
                    ForEach(IslandMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text("The floating panel beside the notch.")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }

            Divider()

            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "Server")
                Text(settings.baseURL.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("Override: defaults write com.vibehub.menubar BaseURL \"…\"")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
            }

            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "Web")
                Text(settings.webUrl.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("Override: defaults write com.vibehub.menubar WebURL \"…\"")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
            }

            if let devices = store.snapshot?.tracker.devices, !devices.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "Devices")
                    ForEach(devices, id: \.name) { device in
                        Text(device.name)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    /// Same `TrackerManager.connect` flow as a pasted onboarding token, a deep link or
    /// an installer handoff — replacing the token from Settings is just a fourth way
    /// for one to arrive, not a separate path.
    private func saveToken() {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isVerifying = true
        savedNote = nil
        Task {
            let result = await tracker.connect(token: trimmed)
            isVerifying = false
            switch result {
            case .success(let username):
                token = ""
                savedNote = "Verified as \(username)."
                store.wake()
            case .failure(let error):
                savedNote = error.errorDescription
            }
        }
    }

    /// One call each way. `enableTrackAtLogin` registers the login item itself (N7) and
    /// clears the persisted opt-out; `disableTrackAtLogin` unregisters it and sets the
    /// opt-out. Setting the login item separately here is what let the two drift apart.
    private func setTrackAtLogin(_ enabled: Bool) async {
        launchError = nil
        if enabled {
            _ = await tracker.enableTrackAtLogin()
        } else {
            _ = await tracker.disableTrackAtLogin()
        }
    }
}
