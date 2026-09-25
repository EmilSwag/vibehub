import SwiftUI

/// The process entry point. A thin shim in front of `VibeHubApp` so a DEBUG build can
/// intercept QA flags (`QAHarness`) *before* the real app is constructed — the app's
/// `init()` starts polling, reconciles the LaunchAgent and consumes the installer
/// handoff, none of which a fixture render may do. Release builds go straight through.
@main
enum AppEntry {
    @MainActor
    static func main() {
        #if DEBUG
        if QAHarness.run(arguments: CommandLine.arguments) { return }
        #endif
        VibeHubApp.main()
    }
}
