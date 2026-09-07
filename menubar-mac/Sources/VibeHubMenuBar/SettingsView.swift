import AppKit
import SwiftUI

/// Rendered inside the popover rather than in a separate `Settings` scene: opening a
/// settings window from an `LSUIElement` menu-bar app needs a private selector that
/// changed name between macOS 13 and 14. Staying in the popover avoids that entirely.
struct SettingsView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    var onClose: () -> Void

    @State private var token = ""
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
                    Button("Save", action: saveToken)
                        .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if store.token != nil {
                        Button("Clear") {
                            Keychain.deleteToken()
                            token = ""
                            savedNote = "Cleared."
                            store.wake()
                        }
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

            VStack(alignment: .leading, spacing: 3) {
                Toggle("Launch at login", isOn: Binding(
                    get: { settings.launchAtLogin },
                    set: { launchError = settings.setLaunchAtLogin($0) }
                ))
                .font(.system(size: 12))
                .toggleStyle(.switch)
                .controlSize(.small)

                if let launchError {
                    Text(launchError).font(.system(size: 11)).foregroundStyle(.secondary)
                }
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

    private func saveToken() {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.saveToken(trimmed)
        token = ""
        savedNote = "Saved."
    }
}
