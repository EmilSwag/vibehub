import Combine
import Foundation
import ServiceManagement

/// Island = Auto / Always / Off (`docs/DESIGN.md`, product decision). "Auto" only shows
/// the floating panel once there's a loaded snapshot to show; "Always" shows it (with a
/// loading/empty state) as soon as the app launches; "Off" never creates the panel.
enum IslandMode: String, CaseIterable, Identifiable, Codable {
    case auto, always, off

    var id: String { rawValue }

    var label: String {
        switch self {
        case .auto: return "Auto"
        case .always: return "Always"
        case .off: return "Off"
        }
    }
}

/// User-facing preferences. The token is deliberately NOT here — it lives in `Keychain`.
///
/// Two distinct server URLs, matching `web/public/tracker/connect.sh`'s own
/// `WEB_URL`/`API_URL` split (two different Railway deployments, two different
/// hostnames — never the same origin):
/// - `webUrl` — the site people load in a browser. Every "open in browser" link
///   (popover/Island actions, the onboarding token page link) uses this.
/// - `baseURL` — the API server. `APIClient` (this app's own `/api/v1/tracker/me`
///   polling) and the embedded tracker CLI's `--api-url` both use this. Earlier builds
///   of this app used a single `baseURL` for both purposes, pointed at `webUrl`'s
///   value — meaning every API request was going to the wrong origin. `adopt(baseURL:
///   webUrl:)` below is what a handoff's `apiUrl` (a *server* URL) actually needs to
///   update, and `StatusStore.init`'s `settings.$baseURL` subscription is what keeps
///   its `APIClient` in sync with it afterward.
@MainActor
final class AppSettings: ObservableObject {
    private enum Key {
        static let showTimeInBar = "ShowTimeInBar"
        static let baseURL = "BaseURL"
        static let webURL = "WebURL"
        static let islandMode = "IslandMode"
        static let hasCompletedOnboarding = "HasCompletedOnboarding"
        static let userDisabledTracking = "UserDisabledTracking"
        static let lastRunBundleVersion = "LastRunBundleVersion"
    }

    /// Overridable without a rebuild, matching the existing `macos/` app's convention:
    ///   defaults write com.vibehub.menubar BaseURL "http://localhost:4000"
    ///   defaults write com.vibehub.menubar WebURL "http://localhost:3000"
    static let defaultBaseURL = URL(string: "https://server-production-cc06.up.railway.app")!
    static let defaultWebURL = URL(string: "https://web-production-da778.up.railway.app")!

    @Published var showTimeInBar: Bool {
        didSet { UserDefaults.standard.set(showTimeInBar, forKey: Key.showTimeInBar) }
    }

    @Published private(set) var launchAtLogin: Bool

    @Published var islandMode: IslandMode {
        didSet { UserDefaults.standard.set(islandMode.rawValue, forKey: Key.islandMode) }
    }

    /// Gates the first-run wizard (`OnboardingWizard`). Set once, on Finish or a final
    /// Skip — never reset by clearing the token, so a returning user who signs out only
    /// sees the plain token field again, not the whole tour.
    @Published var hasCompletedOnboarding: Bool {
        didSet { UserDefaults.standard.set(hasCompletedOnboarding, forKey: Key.hasCompletedOnboarding) }
    }

    /// FC5 "Pause is Off": the single persisted record that the *user* stopped tracking.
    /// Nothing may clear it implicitly — not onboarding, not the pkg `postinstall` app
    /// launch, not an installer handoff, not an upgrade. Only an explicit Start clears
    /// it; only an explicit Off sets it. This is what makes an opt-out survive a
    /// reinstall, and it is checked *before* any reconcile step that would otherwise
    /// re-bootstrap the LaunchAgent (`TrackerManager.reconcileOnLaunch`).
    ///
    /// Distinct from `LaunchAgent.isInstalled`, which is the *current* mechanical state:
    /// the agent can be absent because the user turned it off (this flag true) or because
    /// they never started it at all (this flag false). Only the first must survive an
    /// upgrade that would otherwise helpfully "restore" tracking.
    @Published var userDisabledTracking: Bool {
        didSet { UserDefaults.standard.set(userDisabledTracking, forKey: Key.userDisabledTracking) }
    }

    /// FC5 "Upgrade": `CFBundleShortVersionString` as of the last launch. A pkg upgrade
    /// replaces `Contents/Resources/tracker/{node,vibehub-tracker.cjs}` underneath a
    /// LaunchAgent whose `ProgramArguments` still point at the *replaced inodes* — the
    /// old binaries keep running until something rewrites the plist and restarts the
    /// job. Comparing this against the running bundle on launch is how that is detected
    /// without asking launchd anything.
    @Published private(set) var lastRunBundleVersion: String? {
        didSet { UserDefaults.standard.set(lastRunBundleVersion, forKey: Key.lastRunBundleVersion) }
    }

    /// The version this build actually is. `nil` only in a hand-assembled dev bundle
    /// with no Info.plist — treated as "unknown", which never triggers an upgrade
    /// reconcile (an unknown version must not look like a change on every launch).
    var currentBundleVersion: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    /// The API server. Mutable (not `let`): a handoff's `apiUrl` persists here — see
    /// the type doc above — not just as a one-call override to the login command.
    @Published private(set) var baseURL: URL {
        didSet { UserDefaults.standard.set(baseURL.absoluteString, forKey: Key.baseURL) }
    }

    /// The web site. Same persistence shape as `baseURL`, kept separate on purpose.
    @Published private(set) var webUrl: URL {
        didSet { UserDefaults.standard.set(webUrl.absoluteString, forKey: Key.webURL) }
    }

    init() {
        let defaults = UserDefaults.standard
        // `object(forKey:)` first: `bool(forKey:)` can't tell "false" from "never set",
        // and the bar text should be on out of the box.
        showTimeInBar = defaults.object(forKey: Key.showTimeInBar) as? Bool ?? true
        baseURL = (defaults.string(forKey: Key.baseURL).flatMap(URL.init(string:))) ?? Self.defaultBaseURL
        webUrl = (defaults.string(forKey: Key.webURL).flatMap(URL.init(string:))) ?? Self.defaultWebURL
        launchAtLogin = SMAppService.mainApp.status == .enabled
        islandMode = defaults.string(forKey: Key.islandMode).flatMap(IslandMode.init(rawValue:)) ?? .auto
        hasCompletedOnboarding = defaults.bool(forKey: Key.hasCompletedOnboarding)
        // Defaults to false: a machine that has never been told "off" has not opted out.
        userDisabledTracking = defaults.bool(forKey: Key.userDisabledTracking)
        lastRunBundleVersion = defaults.string(forKey: Key.lastRunBundleVersion)
    }

    /// Called once per launch, after `TrackerManager.reconcileOnLaunch` has had the
    /// chance to compare it — writing it any earlier would erase the very difference
    /// the upgrade check is looking for.
    func recordCurrentBundleVersion() {
        lastRunBundleVersion = currentBundleVersion
    }

    /// The one writer of `baseURL`/`webUrl` after launch — called from
    /// `TrackerManager.connect(token:apiUrl:webUrl:)` when a handoff or
    /// `vibehub://connect` names a non-default server. `@Published` means every
    /// reader — `APIClient` inside `StatusStore` (which re-subscribes, see
    /// `StatusStore.init`), the tracker CLI's next `login` call, every "open in
    /// browser" action — picks up the new value on its own; nothing else needs to be
    /// told separately.
    func adopt(baseURL: URL?, webUrl: URL?) {
        if let baseURL { self.baseURL = baseURL }
        if let webUrl { self.webUrl = webUrl }
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
