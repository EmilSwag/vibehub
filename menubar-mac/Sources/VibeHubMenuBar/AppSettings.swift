import Foundation
import ServiceManagement

/// User-facing preferences. The token is deliberately NOT here — it lives in `Keychain`.
@MainActor
final class AppSettings: ObservableObject {
    private enum Key {
        static let showTimeInBar = "ShowTimeInBar"
        static let baseURL = "BaseURL"
    }

    /// Overridable without a rebuild, matching the existing `macos/` app's convention:
    ///   defaults write com.vibehub.menubar BaseURL "http://localhost:4000"
    static let defaultBaseURL = URL(string: "https://web-production-da778.up.railway.app")!

    @Published var showTimeInBar: Bool {
        didSet { UserDefaults.standard.set(showTimeInBar, forKey: Key.showTimeInBar) }
    }

    @Published private(set) var launchAtLogin: Bool

    let baseURL: URL

    init() {
        let defaults = UserDefaults.standard
        // `object(forKey:)` first: `bool(forKey:)` can't tell "false" from "never set",
        // and the bar text should be on out of the box.
        showTimeInBar = defaults.object(forKey: Key.showTimeInBar) as? Bool ?? true
        baseURL = (defaults.string(forKey: Key.baseURL).flatMap(URL.init(string:))) ?? Self.defaultBaseURL
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    /// `SMAppService` throws when the app isn't in a location macOS will launch from
    /// (still in ~/Downloads, or run straight from `.build/`). Surface it rather than
    /// silently leaving the toggle in a lying state.
    func setLaunchAtLogin(_ enabled: Bool) -> String? {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            launchAtLogin = SMAppService.mainApp.status == .enabled
            return nil
        } catch {
            launchAtLogin = SMAppService.mainApp.status == .enabled
            return "Move VibeHub to /Applications first."
        }
    }
}
