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
    private let menuBarHint: MenuBarHint

    init() {
        let settings = AppSettings()
        let tracker = TrackerManager(settings: settings)
        let store = StatusStore(settings: settings)

        _settings = StateObject(wrappedValue: settings)
        _store = StateObject(wrappedValue: store)
        _tracker = StateObject(wrappedValue: tracker)
        let island = IslandController(settings: settings, store: store)
        let menuBarHint = MenuBarHint()
        self.island = island
        self.menuBarHint = menuBarHint
        // After "You're live": the island opens once on a notch Mac, then — one thing at
        // a time — the one-time pointer shows where VibeHub lives from now on.
        onboardingWindow = OnboardingWindowController(settings: settings, store: store, tracker: tracker, onLive: {
            let pulsing = island.demoPulse()
            let delay = pulsing ? IslandController.pulseSeconds + 0.6 : 0.3
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                MainActor.assumeIsolated { menuBarHint.showOnce(settings: settings) }
            }
        })

        // Launch does no blocking IO on the main thread (1.2.1 freeze: a Keychain prompt
        // inside `StatusStore.init` hung the app before `reconcileOnLaunch` ever ran).
        // Everything below is either in-memory or hops off-main itself.
        tracker.startPolling()

        // FC5: reconcile the LaunchAgent first and independently of the token — tear it
        // down if the user turned tracking off (an upgrade must not resurrect it), or
        // restart it if the bundle version changed under a running job.
        Task { await tracker.reconcileOnLaunch() }

        // The token (config.json, legacy Keychain fallback) is resolved off-main. Only
        // then: start polling the server (menu-bar text and Island need live data before
        // the popover is ever opened), decide whether first run is needed, and migrate a
        // legacy-only token into config.json.
        Task { await settings.refreshLaunchAtLogin() }
        let onboarding = onboardingWindow // a struct's init can't capture `self` in a Task
        Task {
            await TokenStore.shared.load()
            store.start()
            onboarding.showIfNeeded()
            await tracker.migrateLegacyTokenIfNeeded()
        }

        // FC4: a handoff carries **server selection only** — `apiUrl`/`webUrl` — never a
        // credential. The file read + delete happen off-main; adopting hops back.
        Task {
            if let servers = await Task.detached(priority: .utility, operation: { Handoff.consumeInstallerFile() }).value {
                settings.adopt(baseURL: servers.apiUrl, webUrl: servers.webUrl)
                store.wake()
            }
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
