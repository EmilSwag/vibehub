import AppKit
import SwiftUI

/// Owns the standalone, centred first-run window (`OnboardingWizard`) — a real
/// 420x400 `NSWindow`, not embedded in the 320pt menu-bar popover, so first run gets
/// room to breathe. Shown once at launch while `AppSettings.hasCompletedOnboarding` is
/// false; finishing the wizard, or just closing the window, both mark onboarding done.
///
/// Plain `NSWindow`, not a SwiftUI `Window`/`WindowGroup` scene: this app already has
/// exactly one `Scene` (`MenuBarExtra`), and imperatively showing/centring/closing an
/// AppKit window from `TrackerManager`/`AppSettings` state is simpler than threading a
/// second `Scene` with an `isPresented`-style binding through `VibeHubApp.body`.
@MainActor
final class OnboardingWindowController: NSObject, NSWindowDelegate {
    private let settings: AppSettings
    private let store: StatusStore
    private let tracker: TrackerManager
    private var window: NSWindow?
    /// After "You're live": pulse the island (notch Macs) and point at the menu bar.
    private let onLive: () -> Void

    private static let size = CGSize(width: 420, height: 400)

    init(settings: AppSettings, store: StatusStore, tracker: TrackerManager, onLive: @escaping () -> Void = {}) {
        self.settings = settings
        self.store = store
        self.tracker = tracker
        self.onLive = onLive
        super.init()
    }

    func showIfNeeded() {
        guard !settings.hasCompletedOnboarding else { return }
        let window = self.window ?? makeWindow()
        self.window = window
        // `LSUIElement` apps have no Dock icon and don't auto-activate for a new
        // window the way a regular app would — without this, the window can open
        // behind whatever's frontmost, or not reliably take keyboard focus for the
        // token field.
        NSApp.activate(ignoringOtherApps: true)
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.size),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "VibeHub"
        // A clean card look: keep the standard traffic-light close button, hide the
        // title text and the bar's own background.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(rootView: OnboardingWizard(
            store: store,
            settings: settings,
            tracker: tracker,
            onFinished: { [weak self] live in self?.finish(live: live) }
        ))
        return window
    }

    private func finish(live: Bool) {
        settings.hasCompletedOnboarding = true
        window?.close()
        if live { onLive() }
    }

    /// Closing the window any other way (the traffic-light button) is still "don't
    /// show this again" — the same escape hatch a Skip link would have given, just
    /// via the window's own standard control instead of in-content chrome.
    func windowWillClose(_ notification: Notification) {
        settings.hasCompletedOnboarding = true
    }
}
