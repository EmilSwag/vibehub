#if DEBUG
import AppKit
import SwiftUI

/// DEBUG-only visual QA. Two modes, both fully sandboxed from the real install:
///
///     VibeHub --snapshot <dir>                       offscreen @2x PNGs of every surface
///     VibeHub --qa-island <state> [--expanded]       the real island panel, on the real
///                                                    screen, frozen on fixture data
///                             [--qa-cycle]           …opening and closing every 3s, so the
///                                                    spring can be filmed without a mouse
///
/// `<state>` is loaded | loading | needsToken | failed.
///
/// Isolation, which is the point of this file:
/// - The Keychain is never read (`Keychain.fixtureToken`) — a differently-signed debug
///   build would raise an access prompt, and fixtures must not see a real token.
/// - Preferences go to a throwaway `com.vibehub.qa` suite, wiped before and after, never
///   the real `com.vibehub.menubar` domain.
/// - Stores are frozen (`StatusStore(fixture:)`): no poll loop, no network.
/// - The tracker is a fixture (`TrackerManager(fixtureRunning:…)`): it never reads
///   `~/.vibehub`, never runs the embedded CLI, and refuses Start/Stop/Sign-out, so
///   nothing here can install a LaunchAgent or a login item.
/// - `VibeHubApp` is never constructed, so no reconcile, handoff or onboarding window.
@MainActor
enum QAHarness {
    private static let suiteName = "com.vibehub.qa"

    /// Returns true when a QA flag was handled (the process should then exit).
    static func run(arguments: [String]) -> Bool {
        if let index = arguments.firstIndex(of: "--snapshot") {
            let dir = arguments.indices.contains(index + 1) ? arguments[index + 1] : ".temp/qa/mac/snapshots"
            prepareApp(policy: .prohibited)
            let written = snapshotAll(to: URL(fileURLWithPath: dir, isDirectory: true))
            wipeSuite()
            FileHandle.standardError.write(Data("snapshot: wrote \(written) PNGs to \(dir)\n".utf8))
            return true
        }
        if let index = arguments.firstIndex(of: "--qa-island") {
            let state = arguments.indices.contains(index + 1) ? arguments[index + 1] : "loaded"
            runLiveIsland(state: state, expanded: arguments.contains("--expanded"), cycle: arguments.contains("--qa-cycle"))
            return true
        }
        return false
    }

    // MARK: - Fixtures

    enum Fixture: String, CaseIterable {
        case loaded, loading, needsToken, failed
    }

    /// One fixed instant, so every "since" and live timer renders identically per run.
    nonisolated static let now = Date(timeIntervalSince1970: 1_790_000_000)

    /// `project: nil` renders the Private project + "Name it" state (R5).
    static func me(now: Date = now, project: String? = "neon-app") -> TrackerMe {
        let since = now.addingTimeInterval(-(1 * 3600 + 42 * 60))
        return TrackerMe(
            user: .init(id: "u1", username: "mira", displayName: "Mira Chen", avatarUrl: nil, level: 7),
            presence: .init(
                status: .active,
                activity: .init(project: project, tool: "claude-code", model: "claude-opus-5-5", since: since),
                lastSeenAt: now
            ),
            today: .init(activeSeconds: 2 * 3600 + 14 * 60, tokens: 1_284_000, sessionStartedAt: since, estimatedUsd: 3.2, byModel: nil, cachedTokens: 54_000_000),
            tracker: .init(connected: true, lastSeenAt: now, devices: [.init(name: "Mira's MacBook Air", lastSeenAt: now)]),
            friendsOnline: .init(count: 5, sample: [
                .init(username: "jonas", displayName: "Jonas Berg", avatarUrl: nil, status: .active,
                      activity: .init(project: "atlas", tool: "cursor", model: nil, since: now.addingTimeInterval(-1800)), lastSeenAt: now),
                .init(username: "ada", displayName: "Ada Okafor", avatarUrl: nil, status: .active,
                      activity: .init(project: "ledger", tool: "claude-code", model: "gpt-6-sol", since: now.addingTimeInterval(-600)), lastSeenAt: now),
                .init(username: "sol", displayName: "Sol Park", avatarUrl: nil, status: .idle,
                      activity: .init(project: "notes", tool: "codex", model: nil, since: now.addingTimeInterval(-3000)), lastSeenAt: now),
            ])
        )
    }

    private static func fixturePhase(_ fixture: Fixture) -> StatusStore.Phase {
        switch fixture {
        case .loaded: return .loaded(me())
        case .loading: return .loading
        case .needsToken: return .needsToken
        case .failed: return .failed(.transport("offline"))
        }
    }

    private static func localStatus(now: Date) -> LocalTrackerStatus {
        let stamp = ISO8601DateFormatter().string(from: now.addingTimeInterval(-20))
        return LocalTrackerStatus(
            status: "active", projectAlias: "neon-app", tool: "claude-code", model: nil, updatedAt: stamp,
            connected: true, lastConnectionSeenAt: stamp, lastConnectionCheckAt: stamp,
            configFingerprint: nil, collectionPolicy: nil, authRejected: false, sources: nil
        )
    }

    private struct Rig {
        let settings: AppSettings
        let store: StatusStore
        let tracker: TrackerManager
    }

    /// `now` defaults to the pinned instant; live mode passes the real clock so the
    /// tracker row's "20s ago" is not days old.
    private static func rig(_ fixture: Fixture, now: Date = now) -> Rig {
        wipeSuite()
        Keychain.fixtureToken = .some(fixture == .needsToken ? nil : "vh_fixture_token")
        let settings = AppSettings(defaults: UserDefaults(suiteName: suiteName)!)
        let phase: StatusStore.Phase = fixture == .loaded ? .loaded(me(now: now)) : fixturePhase(fixture)
        let store = StatusStore(settings: settings, fixture: phase, now: now)
        let signedIn = fixture != .needsToken
        let tracker = TrackerManager(
            settings: settings,
            fixtureRunning: signedIn,
            trackAtLogin: signedIn,
            status: signedIn ? localStatus(now: Date()) : nil
        )
        return Rig(settings: settings, store: store, tracker: tracker)
    }

    private static func wipeSuite() {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
    }

    private static func prepareApp(policy: NSApplication.ActivationPolicy) {
        let app = NSApplication.shared
        app.setActivationPolicy(policy)
        app.finishLaunching()
    }

    // MARK: - Snapshot mode

    private static func snapshotAll(to dir: URL) -> Int {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var count = 0
        func save<V: View>(_ name: String, _ view: V, size: CGSize? = nil, dark: Bool) {
            if render(view, size: size, dark: dark, to: dir.appendingPathComponent("\(name).png")) { count += 1 }
        }

        for fixture in Fixture.allCases {
            let rig = rig(fixture)
            let island = IslandController(settings: rig.settings, store: rig.store)
            for expanded in [false, true] {
                let snap = island.debugSnapshot(expanded: expanded)
                let tag = "island-\(expanded ? "expanded" : "collapsed")-\(fixture.rawValue)"
                // Alone, at its exact frame…
                save(tag, snap.view.frame(width: snap.size.width, height: snap.size.height), size: snap.size, dark: true)
                // …and in context: under a drawn menu bar and notch at this screen's
                // real geometry, which is what "hugs the notch" has to be judged against.
                let context = NotchContext(island: snap.view, islandSize: snap.size, screen: snap.screen)
                save(tag + "-context", context, size: context.canvasSize, dark: false)
            }

            for dark in [false, true] {
                let popover = PopoverView(store: rig.store, settings: rig.settings, tracker: rig.tracker)
                save("popover-\(fixture.rawValue)-\(dark ? "dark" : "light")", PopoverChrome(content: popover), dark: dark)
            }
        }

        for dark in [false, true] {
            let rig = rig(.loaded)
            let settings = SettingsView(store: rig.store, settings: rig.settings, tracker: rig.tracker, onClose: {})
                .padding(12)
                .frame(width: 320)
            save("settings-\(dark ? "dark" : "light")", PopoverChrome(content: settings), dark: dark)
        }
        do {
            let rig = rig(.needsToken)
            let settings = SettingsView(store: rig.store, settings: rig.settings, tracker: rig.tracker, onClose: {})
                .padding(12)
                .frame(width: 320)
            save("settings-signedout-light", PopoverChrome(content: settings), dark: false)
        }

        for (index, step) in OnboardingStep.allCases.enumerated() {
            for dark in [false, true] {
                let rig = rig(step == .connect ? .needsToken : .loaded)
                let wizard = OnboardingWizard(store: rig.store, settings: rig.settings, tracker: rig.tracker,
                                              initialStep: step, autoStart: false, onFinished: { _ in })
                save("onboarding-\(index + 1)-\(step)-\(dark ? "dark" : "light")",
                     wizard.background(Color(nsColor: .windowBackgroundColor)), dark: dark)
            }
        }

        // Private project (null alias) → "Private project" + "Name it".
        do {
            let rig = rig(.loaded)
            let store = StatusStore(settings: rig.settings, fixture: .loaded(me(project: nil)), now: now)
            let popover = PopoverView(store: store, settings: rig.settings, tracker: rig.tracker)
            save("popover-private-project-light", PopoverChrome(content: popover), dark: false)
            let island = IslandController(settings: rig.settings, store: store)
            let snap = island.debugSnapshot(expanded: true)
            save("island-expanded-private-project", snap.view.frame(width: snap.size.width, height: snap.size.height), size: snap.size, dark: true)
        }

        for dark in [false, true] {
            // On a mid-grey "desktop" so the bubble's edge and arrow are judged honestly.
            save("menubar-hint-\(dark ? "dark" : "light")", MenuBarHintView(arrowX: 150).padding(16).background(Color(white: 0.45)), dark: dark)
        }

        // Model/format table, for eyeballing alongside the PNGs.
        let samples = ["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5",
                       "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022", "claude-opus-4-1[1m]",
                       "gpt-6-sol", "gpt-6-luna", "gpt-5.6-terra", "gpt-4o-2024-08-06", "o3", "gemini-2.5-pro",
                       "unknown", "null", "", "<synthetic>"]
        var table = samples.map { "\($0.isEmpty ? "(empty)" : $0) -> \(Format.modelLabel($0) ?? "nil")" }
        table += ["project nil -> \(Format.projectLabel(nil))", "project unknown -> \(Format.projectLabel("unknown"))",
                  "project neon-app -> \(Format.projectLabel("neon-app"))",
                  "cached 540000000 -> \(Format.cachedLine(540_000_000) ?? "nil")", "cached nil -> \(Format.cachedLine(nil) ?? "nil")"]
        // Island default: notch Mac + implicit `off` → on; an explicit choice sticks.
        func islandCase(_ label: String, stored: String?, explicit: Bool, notch: Bool) {
            wipeSuite()
            let d = UserDefaults(suiteName: suiteName)!
            if let stored { d.set(stored, forKey: "IslandMode") }
            if explicit { d.set(true, forKey: "IslandModeExplicit") }
            table.append("island \(label) -> \(AppSettings(defaults: d, hasNotch: notch).islandMode.rawValue)")
        }
        islandCase("notch, fresh", stored: nil, explicit: false, notch: true)
        islandCase("notch, old implicit off", stored: "off", explicit: false, notch: true)
        islandCase("notch, explicit off", stored: "off", explicit: true, notch: true)
        islandCase("notchless, implicit off", stored: "off", explicit: false, notch: false)
        do {
            wipeSuite()
            let settings = AppSettings(defaults: UserDefaults(suiteName: suiteName)!, hasNotch: true)
            settings.chooseIslandMode(.off)
            let reread = AppSettings(defaults: UserDefaults(suiteName: suiteName)!, hasNotch: true)
            table.append("island chooseIslandMode(off) then relaunch -> \(reread.islandMode.rawValue) explicit=\(reread.islandModeIsExplicit)")
            wipeSuite()
        }
        // Decode must not fail when cachedTokens/project are absent or null.
        let json = #"{"user":{"id":"u","username":"a","displayName":null,"avatarUrl":null,"level":1},"presence":{"status":"active","activity":{"project":null,"tool":"claude-code","model":"claude-opus-5-5","since":"2026-09-26T00:00:00Z"},"lastSeenAt":null},"today":{"activeSeconds":60,"tokens":10,"sessionStartedAt":null},"tracker":{"connected":true,"lastSeenAt":null,"devices":[]},"friendsOnline":{"count":0,"sample":[]}}"#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            let me = try decoder.decode(TrackerMe.self, from: Data(json.utf8))
            table.append("decode without cachedTokens/estimatedUsd, null project -> ok (cached=\(String(describing: me.today.cachedTokens)), line=\(Format.activityLine(me.presence.activity!)))")
        } catch {
            table.append("decode FAILED: \(error)")
        }
        try? table.joined(separator: "\n").appending("\n").write(to: dir.appendingPathComponent("format-check.txt"), atomically: true, encoding: .utf8)
        return count
    }

    /// Offscreen, at exactly 2 pixels per point regardless of the attached display.
    /// `NSHostingView` + `cacheDisplay` rather than `ImageRenderer`, which draws AppKit-
    /// backed controls (switches, secure fields, segmented pickers) as placeholders.
    private static func render<V: View>(_ view: V, size: CGSize?, dark: Bool, to url: URL) -> Bool {
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let hosting = NSHostingView(rootView: view)
        hosting.appearance = appearance
        let target = size ?? hosting.fittingSize
        let window = NSWindow(
            contentRect: NSRect(origin: CGPoint(x: -20_000, y: -20_000), size: target),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.appearance = appearance
        window.isOpaque = false
        window.backgroundColor = .clear
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: target)
        hosting.layoutSubtreeIfNeeded()
        // One turn of the run loop for onAppear/layout passes to settle.
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        hosting.layoutSubtreeIfNeeded()

        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(ceil(target.width * 2)),
            pixelsHigh: Int(ceil(target.height * 2)),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { return false }
        rep.size = target
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        window.contentView = nil
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: url)) != nil
    }

    // MARK: - Live mode

    private static var liveRetainer: [AnyObject] = []

    private static func runLiveIsland(state: String, expanded: Bool, cycle: Bool) {
        let fixture = Fixture(rawValue: state) ?? .loaded
        prepareApp(policy: .accessory)
        let rig = rig(fixture, now: Date())
        rig.settings.islandMode = .always
        let island = IslandController(settings: rig.settings, store: rig.store)
        liveRetainer = [rig.settings, rig.store, rig.tracker, island]
        if expanded {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { island.debugSetExpanded(true) }
        }
        if cycle {
            var open = false
            let timer = Timer(timeInterval: 3, repeats: true) { _ in
                MainActor.assumeIsolated {
                    open.toggle()
                    island.debugSetExpanded(open)
                }
            }
            RunLoop.main.add(timer, forMode: .common)
            liveRetainer.append(timer)
            // Film the spring: the panel's real frame height, every tick it changes.
            var lastHeight: CGFloat = -1
            let start = Date()
            let sampler = Timer(timeInterval: 1.0 / 120.0, repeats: true) { _ in
                MainActor.assumeIsolated {
                    guard let panel = NSApp.windows.first(where: { $0 is NSPanel }) else { return }
                    let height = panel.frame.height
                    guard height != lastHeight else { return }
                    lastHeight = height
                    let line = String(format: "%.3f %.0fx%.0f\n", Date().timeIntervalSince(start), panel.frame.width, height)
                    FileHandle.standardError.write(Data(line.utf8))
                }
            }
            RunLoop.main.add(sampler, forMode: .common)
            liveRetainer.append(sampler)
        }
        // Wipe the throwaway suite on the way out, however the run ends.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            wipeSuite()
            exit(0)
        }
        source.resume()
        liveRetainer.append(source as AnyObject)
        NSApplication.shared.run()
    }
}

/// The popover's own window chrome, approximated for offscreen renders: the system
/// window background and the popover's corner radius.
private struct PopoverChrome<Content: View>: View {
    let content: Content

    var body: some View {
        content
            .background(Color(nsColor: .windowBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(10)
    }
}

/// A strip of menu bar with the hardware notch drawn where this screen reports it, and
/// the island laid over it at its real frame — so a render shows whether the island
/// covers the notch exactly, and whether anything sits underneath the camera housing.
private struct NotchContext: View {
    let island: AnyView
    let islandSize: CGSize
    let screen: NSScreen?

    private var notchWidth: CGFloat {
        guard let screen, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else { return 0 }
        return max(0, right.minX - left.maxX)
    }

    private var menuBarHeight: CGFloat {
        guard let screen else { return 24 }
        return screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : max(24, screen.frame.maxY - screen.visibleFrame.maxY)
    }

    var canvasSize: CGSize {
        CGSize(width: max(560, islandSize.width + 140), height: max(menuBarHeight, islandSize.height) + 36)
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Desktop, then the translucent menu bar.
            Color(white: 0.42)
            Color(white: 0.93).frame(height: menuBarHeight).frame(maxHeight: .infinity, alignment: .top)
            if notchWidth > 0 {
                // The camera housing. A hairline outline (QA-only) marks where it ends,
                // since black-on-black would otherwise hide a misfit.
                UnevenBottomNotch(radius: 8)
                    .fill(Color.black)
                    .frame(width: notchWidth, height: menuBarHeight)
            }
            island
                .frame(width: islandSize.width, height: islandSize.height)
                .offset(y: notchWidth > 0 ? 0 : menuBarHeight)
            if notchWidth > 0 {
                UnevenBottomNotch(radius: 8)
                    .stroke(Color(white: 0.5).opacity(0.9), style: StrokeStyle(lineWidth: 0.5, dash: [2, 2]))
                    .frame(width: notchWidth, height: menuBarHeight)
            }
        }
        .frame(width: canvasSize.width, height: canvasSize.height, alignment: .top)
    }
}

private struct UnevenBottomNotch: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - radius, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - radius), control: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
#endif
