import SwiftUI

// NB: this file must NOT be called `main.swift` — SwiftPM treats that name as top-level
// code, which conflicts with `@main`.

// @MainActor on the struct, not just on `body`: `init()` constructs two @MainActor
// observable objects and `barText` reads @MainActor state, both of which are diagnosed
// in a nonisolated context.
@main
@MainActor
struct VibeHubMenuBarApp: App {
    @StateObject private var settings: AppSettings
    @StateObject private var store: StatusStore

    init() {
        let settings = AppSettings()
        _settings = StateObject(wrappedValue: settings)
        _store = StateObject(wrappedValue: StatusStore(settings: settings))
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: store, settings: settings)
                .onAppear { store.start() }
        } label: {
            // 16pt monochrome template glyph; SF Symbols are template images already, so
            // the menu bar tints them for light/dark and for the highlighted state.
            HStack(spacing: 4) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
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
