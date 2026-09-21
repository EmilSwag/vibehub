import AppKit
import SwiftUI

// NB: this file must NOT be called `main.swift` — SwiftPM treats that name as top-level
// code, which conflicts with `@main`.

/// Routes `application(_:open:)` — the reliable way to handle a custom URL scheme
/// (`vibehub://connect?apiUrl=…&webUrl=…`; never a token, see `Handoff`) for a
/// `MenuBarExtra`-only app. SwiftUI's own
/// `.onOpenURL` attaches to a Scene's *content*, which for `.window`-style
/// `MenuBarExtra` is only actually in the view hierarchy while the popover is open —
/// exactly the state a cold-launch-via-URL app usually isn't in yet.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var onOpenURLs: (([URL]) -> Void)?

    func application(_ application: NSApplication, open urls: [URL]) {
        onOpenURLs?(urls)
    }
}

// @MainActor on the struct, not just on `body`: `init()` constructs several @MainActor
// observable objects and `barText` reads @MainActor state, both of which are diagnosed
// in a nonisolated context.
@main
@MainActor
struct VibeHubApp: App {
    // The `(AppDelegate.self)` argument IS the default for this property — unlike
    // `@StateObject`, `NSApplicationDelegateAdaptor` has no `init(wrappedValue:)`
    // overload, only `init(_ delegateType: DelegateType.Type = ...)`, so this is the
    // only supported way to provide one. SwiftUI applies it automatically (same as any
    // other property with a default value expression) before `init()`'s body runs, so
    // `appDelegate` is already a live, fully-constructed instance by the time init()
    // configures it below — no `_appDelegate = ...` assignment needed or possible.
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var settings: AppSettings
    @StateObject private var store: StatusStore
    @StateObject private var tracker: TrackerManager
    private let island: IslandController
    private let onboardingWindow: OnboardingWindowController

    init() {
        let settings = AppSettings()
        let tracker = TrackerManager(settings: settings)
        let store = StatusStore(settings: settings)

        _settings = StateObject(wrappedValue: settings)
        _store = StateObject(wrappedValue: store)
        _tracker = StateObject(wrappedValue: tracker)
        island = IslandController(settings: settings, store: store)
        onboardingWindow = OnboardingWindowController(settings: settings, store: store, tracker: tracker)

        // Menu-bar apps have no other launch hook: `MenuBarExtra`'s `.window` style
        // only builds its content view (and fires `.onAppear`) once the user first
        // clicks the item, but the Island and the menu-bar text both need live data
        // before that ever happens.
        store.start()
        tracker.startPolling()
        onboardingWindow.showIfNeeded()

        // FC5: reconcile the LaunchAgent against this launch before anything else can
        // act on it — tear it down if the user had turned tracking off (an upgrade must
        // not resurrect it), or rewrite and restart it if the bundle version changed and
        // the running job is executing replaced binaries.
        Task { await tracker.reconcileOnLaunch() }

        // FC4: a handoff carries **server selection only** — `apiUrl`/`webUrl` — never a
        // credential. Both install entrances are tokenless; the token is typed once, by
        // hand, in onboarding. So this adopts servers and nothing else, and there is no
        // `connect` to fire here at all.
        if let servers = Handoff.consumeInstallerFile() {
            settings.adopt(baseURL: servers.apiUrl, webUrl: servers.webUrl)
            store.wake()
        }

        // `appDelegate` already exists (see its declaration above) — configure it now
        // that `store` is ready, rather than trying to pre-build it before SwiftUI
        // creates it. Same rule: `vibehub://connect` can point the app at a different
        // server, and can no longer carry a token (`Handoff.parse` ignores one).
        appDelegate.onOpenURLs = { urls in
            guard let url = urls.first, let servers = Handoff.parse(url: url) else { return }
            settings.adopt(baseURL: servers.apiUrl, webUrl: servers.webUrl)
            store.wake()
        }
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: store, settings: settings, tracker: tracker)
        } label: {
            // The brand mark as an 18pt template image (`BrandMark.swift`), so the menu
            // bar tints it for light/dark and for the highlighted state exactly as it
            // would an SF Symbol — one figure across the menu bar, onboarding, the Island
            // and the app icon, instead of a system chevron standing in for the mark.
            HStack(spacing: 4) {
                Image(nsImage: BrandMarkImage.menuBar)
                if let text = barText {
                    Text(text).monospacedDigit()
                }
            }
        }
        // `.window` gives a real popover panel instead of an NSMenu, which is what the
        // avatars, skeletons and inline settings need.
        .menuBarExtraStyle(.window)
    }

    /// Compact today-active time beside the glyph, e.g. "2h 14m". Hidden when the toggle
    /// is off, and while there is nothing meaningful to show — an empty menu bar item is
    /// better than "0m" on a machine that hasn't started working yet.
    private var barText: String? {
        guard settings.showTimeInBar else { return nil }
        guard let seconds = store.liveActiveSeconds, seconds >= 60 else { return nil }
        return Format.compactDuration(seconds: seconds)
    }
}
