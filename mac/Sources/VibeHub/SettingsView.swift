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
    @State private var showTrouble = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Settings").font(.system(size: 14, weight: .semibold))
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(Color.primary.opacity(0.07)))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Back")
            }

            section("Account") {
                if store.token == nil {
                    // Signed out: the same one-button connect as first run.
                    OnboardingView(store: store, settings: settings, tracker: tracker)
                } else {
                    if let me = store.snapshot {
                        Text("Connected as @\(me.user.username)").font(.system(size: 12))
                    }
                    // N1(b): Sign out is the whole operation — stop the tracker, release
                    // this device's connection, remove the login item, forget the token.
                    Button(tracker.isBusy ? "Signing out\u{2026}" : "Sign Out of This Mac") {
                        Task {
                            await tracker.signOut()
                            token = ""
                            savedNote = "Signed out on this Mac."
                            store.wake()
                        }
                    }
                    .buttonStyle(.link)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .disabled(tracker.isBusy)

                    // Power-user bits (replace/copy the device code) stay one click away.
                    if showTrouble {
                        HStack(spacing: 6) {
                            SecureField("Paste a new code", text: $token)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                                .onSubmit(saveToken)
                            Button(isVerifying ? "Checking\u{2026}" : "Save", action: saveToken)
                                .disabled(isVerifying || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        Button("Copy this Mac\u{2019}s code") {
                            guard let current = store.token else { return }
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(current, forType: .string)
                            savedNote = "Copied."
                        }
                        .buttonStyle(.link)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    } else {
                        Button("Trouble?") { showTrouble = true }
                            .buttonStyle(.link)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                if let savedNote {
                    Text(savedNote).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }

            Divider()

            section("General") {
                switchRow("Time in the menu bar", isOn: $settings.showTimeInBar)

                // One switch, because it is one decision: the tracker's LaunchAgent
                // and the app's login item together (Lumi; N7). The enable/disable
                // calls own both halves, which is also what makes Off durable (FC5).
                switchRow(
                    "Start with my Mac",
                    isOn: Binding(
                        get: { tracker.isTrackAtLoginEnabled },
                        set: { enabled in Task { await setTrackAtLogin(enabled) } }
                    ),
                    busy: tracker.isBusy,
                    disabled: tracker.isBusy || store.token == nil
                )
                Text(store.token == nil
                     ? "Connect first."
                     : "Keeps counting after a restart. Off stays off.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                // A failure gets a symbol and full weight so it can't pass for the
                // caption above it — no hue: presence is the product's only colour.
                if let message = tracker.lastActionError ?? tracker.launchAtLoginError ?? launchError {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    Text("Island").font(.system(size: 12))
                    Spacer()
                    // Any pick here is the user's own choice — defaults never override it.
                    Picker("Island", selection: Binding(
                        get: { settings.islandMode },
                        set: { settings.chooseIslandMode($0) }
                    )) {
                        ForEach(IslandMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .controlSize(.small)
                    .fixedSize()
                }
            }

            Divider()

            // Read-only facts. How to override the servers is documented in the README,
            // not printed at everyone who opens Settings.
            section("This Mac") {
                infoRow("Server", settings.baseURL.host ?? settings.baseURL.absoluteString)
                    .help(settings.baseURL.absoluteString)
                infoRow("Web", settings.webUrl.host ?? settings.webUrl.absoluteString)
                    .help(settings.webUrl.absoluteString)
                if let devices = store.snapshot?.tracker.devices, !devices.isEmpty {
                    infoRow(devices.count == 1 ? "Device" : "Devices", devices.map(\.name).joined(separator: ", "))
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            content()
        }
    }

    /// Label left, switch right — the macOS Settings arrangement — so a row of
    /// switches lines up down one edge instead of trailing each label.
    private func switchRow(_ title: String, isOn: Binding<Bool>, busy: Bool = false, disabled: Bool = false) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.system(size: 12))
            Spacer(minLength: 8)
            // `launchctl bootstrap` plus a `login` round trip is seconds of nothing
            // happening; say so beside the switch (Lumi).
            if busy { ProgressView().controlSize(.small) }
            Toggle(title, isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
                .disabled(disabled)
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).font(.system(size: 12)).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
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
