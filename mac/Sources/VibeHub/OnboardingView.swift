import AppKit
import SwiftUI

/// Connecting this Mac: browser pairing first (one click, no typing), a pasted token as
/// the fallback. Controls only — no heading — so each host (the first-run wizard, the
/// popover for a signed-out returning user) says it once, in its own voice.
struct OnboardingView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    /// `.center` in the wizard, `.leading` in the popover.
    var alignment: HorizontalAlignment = .leading
    var onSaved: ((_ viaKeyboard: Bool) -> Void)? = nil

    @State private var token = ""
    @State private var isVerifying = false
    @State private var isPairing = false
    @State private var pairingCode: String?
    @State private var errorMessage: String?
    @State private var showManual = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: alignment, spacing: 10) {
            if isPairing {
                pairingStatus
            } else {
                Button("Connect in Browser", action: startBrowserPairing)
                    .buttonStyle(PrimaryButtonStyle())
            }

            if let username = tracker.connectedUsername {
                Text("Connected as @\(username)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            } else if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.circle")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if showManual {
                manualEntry
            } else {
                Button("Use a token instead") { showManual = true }
                    .buttonStyle(.link)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
        }
    }

    private var pairingStatus: some View {
        VStack(alignment: alignment, spacing: 6) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Waiting for your browser\u{2026}")
                    .font(.system(size: 12, weight: .medium))
            }
            if let pairingCode {
                // The code to match against the browser page — the one detail worth
                // reading, so it gets the weight.
                Text(pairingCode)
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .tracking(1.5)
                    .textSelection(.enabled)
            }
            Button("Cancel", action: cancelPairing)
                .buttonStyle(.link)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    private var manualEntry: some View {
        HStack(spacing: 6) {
            SecureField("Paste your device token", text: $token)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11, design: .monospaced))
                .onSubmit { verify(viaKeyboard: true) }
            Button(isVerifying ? "Checking\u{2026}" : "Connect") { verify(viaKeyboard: false) }
                .buttonStyle(.bordered)
                .disabled(isVerifying || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .frame(maxWidth: 300)
    }

    private func startBrowserPairing() {
        isPairing = true
        errorMessage = nil
        let client = APIClient(baseURL: settings.baseURL)
        let deviceName = Host.current().localizedName ?? "Mac"

        pollTask = Task { @MainActor in
            let requestResult = await client.pairRequest(deviceName: deviceName, os: "mac")
            guard !Task.isCancelled else { return }

            switch requestResult {
            case .failure(let error):
                isPairing = false
                errorMessage = error.errorDescription
                return
            case .success(let pair):
                pairingCode = pair.userCode
                if let url = URL(string: pair.verificationUri) {
                    NSWorkspace.shared.open(url)
                }

                // Poll every `interval` seconds until approved, expired or cancelled.
                let deadline = Date().addingTimeInterval(Double(pair.expiresIn))
                while !Task.isCancelled && Date() < deadline {
                    try? await Task.sleep(nanoseconds: UInt64(max(1, pair.interval)) * 1_000_000_000)
                    guard !Task.isCancelled else { return }

                    let pollResult = await client.pairPoll(deviceCode: pair.deviceCode)
                    guard !Task.isCancelled else { return }

                    if case .success(let poll) = pollResult {
                        if poll.status == "approved", let token = poll.token {
                            let connectResult = await tracker.connect(token: token)
                            if case .success = connectResult {
                                isPairing = false
                                store.wake()
                                onSaved?(false)
                                return
                            } else if case .failure(let error) = connectResult {
                                isPairing = false
                                errorMessage = error.errorDescription
                                return
                            }
                        } else if poll.status == "expired" {
                            isPairing = false
                            errorMessage = "That request expired. Try again."
                            return
                        }
                    }
                }

                if !Task.isCancelled {
                    isPairing = false
                    errorMessage = "No answer from the browser. Try again."
                }
            }
        }
    }

    private func cancelPairing() {
        pollTask?.cancel()
        pollTask = nil
        isPairing = false
        pairingCode = nil
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
