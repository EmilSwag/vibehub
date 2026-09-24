import AppKit
import SwiftUI

/// First run — connects the Mac to VibeHub via browser pairing (zero typing),
/// with manual token entry available as a fallback.
struct OnboardingView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    var onSaved: ((_ viaKeyboard: Bool) -> Void)? = nil

    @State private var token = ""
    @State private var isVerifying = false
    @State private var isPairing = false
    @State private var pairingCode: String?
    @State private var errorMessage: String?
    @State private var showManual = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                BrandMark(size: 15)
                Text("VibeHub").font(.system(size: 14, weight: .semibold))
            }

            Text("Connect your Mac to see your AI coding activity.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            // Primary flow: One-click browser pairing
            if !isPairing {
                Button("Connect in Browser") {
                    startBrowserPairing()
                }
                .buttonStyle(PrimaryButtonStyle())
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Waiting for approval in browser\u{2026}")
                            .font(.system(size: 12, weight: .medium))
                    }

                    if let pairingCode {
                        HStack(spacing: 6) {
                            Text("Pairing code:")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                            Text(pairingCode)
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        }
                    }

                    Button("Cancel") {
                        cancelPairing()
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 11))
                }
                .padding(10)
                .background(Color.primary.opacity(0.04))
                .cornerRadius(6)
            }

            if let username = tracker.connectedUsername {
                Text("Connected as @\(username)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            } else if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            Divider().padding(.vertical, 2)

            // Secondary manual path
            DisclosureGroup(isExpanded: $showManual) {
                VStack(alignment: .leading, spacing: 8) {
                    SecureField("Paste device token", text: $token)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11, design: .monospaced))
                        .onSubmit { verify(viaKeyboard: true) }

                    Button(isVerifying ? "Verifying\u{2026}" : "Verify token") {
                        verify(viaKeyboard: false)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isVerifying || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.top, 4)
            } label: {
                Text("Or enter token manually")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
        }
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

                // Poll every 2 seconds until approved or cancelled
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
                            errorMessage = "Pairing expired. Try again."
                            return
                        }
                    }
                }

                if !Task.isCancelled {
                    isPairing = false
                    errorMessage = "Pairing timed out."
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
