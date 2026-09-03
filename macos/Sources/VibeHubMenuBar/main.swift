import AppKit

// Reads (never writes) ~/.vibehub/status.json, written by vibehub/tracker — the only
// contract this app depends on. Exact schema: ../docs/ARCHITECTURE.md §4.4.
// Never talks to the server directly and never needs a device token.

// Build-time default, overridable without a rebuild via:
//   defaults write VibeHubMenuBar WebAppURL "https://vibehub.app"
// per docs/BUILD_PLAN.md §3 ("WEB_APP_URL is a build-time constant, overridable via
// `defaults write` for local testing").
let defaultWebAppURLString = "http://localhost:5173"

var WEB_APP_URL: URL {
    if let override = UserDefaults.standard.string(forKey: "WebAppURL"), let url = URL(string: override) {
        return url
    }
    return URL(string: defaultWebAppURLString)!
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var statusLineItem: NSMenuItem?
    private var watcher: StatusFileWatcher?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "VibeHub"

        let menu = NSMenu()
        let statusLineItem = NSMenuItem(title: "Not tracking yet", action: nil, keyEquivalent: "")
        menu.addItem(statusLineItem)
        self.statusLineItem = statusLineItem
        menu.addItem(NSMenuItem.separator())
        menu.addItem(
            NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "o")
        )
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem?.menu = menu

        // 5s poll timer, not a file-descriptor watch — see StatusFileWatcher.swift for
        // why (the tracker's atomic rename-on-write breaks fd-based watching).
        let watcher = StatusFileWatcher { [weak self] status in
            self?.render(status)
        }
        watcher.start()
        self.watcher = watcher
    }

    private func render(_ status: TrackerStatus) {
        statusItem?.button?.title = status.statusBarTitle
        statusLineItem?.title = status.menuStatusLine()
    }

    @objc private func openDashboard() {
        NSWorkspace.shared.open(WEB_APP_URL)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu-bar-only, no Dock icon
app.run()
