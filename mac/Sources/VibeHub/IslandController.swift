import AppKit
import Combine
import QuartzCore
import SwiftUI

/// The floating panel that hugs the notch (or sits top-centre on a Mac without one):
/// collapsed = a small pill, hover = spring-expands into a card, auto-collapses on
/// mouse-out. AppKit, not a second SwiftUI `Scene` — `MenuBarExtra` already owns the
/// one popover window this app gets from that API, and notch-hugging placement needs
/// `NSScreen.auxiliaryTopLeftArea`/`auxiliaryTopRightArea` (macOS 12+) plus manual
/// frame animation that SwiftUI's declarative window management doesn't expose.
///
/// Hover and click are driven by `NSEvent` global + local **mouse** monitors rather than
/// an `NSTrackingArea`: the panel is `.nonactivatingPanel` and is not key while merely
/// hovered, so a view-level tracking area would only ever see events while this app
/// happens to be frontmost. Global *mouse* monitoring needs no special permission.
///
/// Escape is deliberately **not** a global key monitor. Global `.keyDown` delivery
/// requires Input Monitoring in System Settings — a permission this app's definition of
/// done forbids requesting, and without which macOS silently drops the event, leaving a
/// key binding that looks implemented and does nothing. Instead the panel can become key
/// *after an explicit click* (`IslandPanel.canBecomeKey`), so Escape is an ordinary
/// local key event for as long as the user is actually interacting with it, and a click
/// anywhere outside collapses it. Both are permission-free and both are observable.
@MainActor
final class IslandController: NSObject, ObservableObject {
    @Published fileprivate(set) var isExpanded = false
    /// The target screen's notch geometry — shared with `IslandView` so the content's
    /// wings and the window's frame are cut from the same numbers.
    @Published private(set) var metrics = IslandMetrics.notchless

    private let settings: AppSettings
    private let store: StatusStore
    private var panel: NSPanel?
    private var cancellables: Set<AnyCancellable> = []

    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var isHovering = false
    private var hoverWorkItem: DispatchWorkItem?
    private var screenObserver: NSObjectProtocol?
    /// A first-connect demo pulse requested before the panel had anything to show.
    private var pendingPulse = false

    /// A panel that can take key focus, but only once someone clicks it. `NSPanel`'s
    /// default for `.nonactivatingPanel` is never to become key, which is right while
    /// hovering — the island must not steal focus from the editor underneath it — but it
    /// is also what makes a local Escape monitor useless. Allowing key status on demand
    /// is the permission-free alternative to a global key tap (N5).
    private final class IslandPanel: NSPanel {
        override var canBecomeKey: Bool { true }
        /// Still never the *main* window: this is a decorative always-on-top panel, and
        /// becoming main would move the app's menu bar focus with it.
        override var canBecomeMain: Bool { false }
    }

    /// Asymmetric on purpose: quick to commit once the pointer settles on the island
    /// (but not on a flick across the menu bar), slow to let go, so briefly drifting off
    /// the card while reading it does not snap it shut.
    private static let hoverEnterDelay: TimeInterval = 0.08
    private static let hoverExitDelay: TimeInterval = 0.3
    /// Escape key code (`kVK_Escape`); AppKit has no named constant for it.
    private static let escapeKeyCode: UInt16 = 53
    /// The window frame is driven by a real spring (`FrameSpring`), not an
    /// `NSAnimationContext` bezier. Opening gets a lively settle with a hint of
    /// overshoot — the moment the user is waiting on; closing is near-critically damped
    /// and quicker, the island getting out of the way.
    private static let expandSpring = FrameSpring.Parameters(response: 0.42, dampingFraction: 0.74)
    private static let collapseSpring = FrameSpring.Parameters(response: 0.3, dampingFraction: 0.92)
    private let spring = FrameSpring()
    private var springTimer: Timer?

    init(settings: AppSettings, store: StatusStore) {
        self.settings = settings
        self.store = store
        super.init()
        Publishers.CombineLatest(settings.$islandMode, store.$phase)
            .receive(on: RunLoop.main)
            .sink { [weak self] mode, _ in self?.updateVisibility(mode: mode) }
            .store(in: &cancellables)
    }

    // No `deinit`: this controller lives as long as the app (`VibeHubApp` holds it in a
    // `let`), the monitors are already removed in `hidePanel()`, and a nonisolated
    // `deinit` reading @MainActor stored properties is a compile hazard that would buy
    // nothing at runtime.

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    private func updateVisibility(mode: IslandMode) {
        switch mode {
        case .off:
            hidePanel()
        case .always:
            showPanel()
        case .auto:
            store.snapshot != nil ? showPanel() : hidePanel()
        }
    }

    private func showPanel() {
        // Called on every published phase — i.e. every poll. Once the panel exists, only
        // follow the target size (a loaded card and a message card differ in height);
        // resetting `isExpanded` here collapsed an open island every 15 seconds.
        if panel != nil, panel?.isVisible == true {
            applyFrame(animated: true)
            return
        }
        let panel = self.panel ?? makePanel()
        self.panel = panel
        isExpanded = false
        // `applyFrame` owns visibility now: it orders the panel out on a full-screen
        // display and front otherwise. Calling `orderFrontRegardless` here as well would
        // undo that decision the instant it was made.
        applyFrame(animated: false)
        installMonitorsIfNeeded()
        installScreenObserverIfNeeded()
        if pendingPulse {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.runPulse() }
        }
    }

    // MARK: - First-connect demo

    /// How long the demo keeps the island open.
    static let pulseSeconds: TimeInterval = 2.8

    /// Right after "You're live": open the island once so people see where it lives,
    /// then fold it back. Notch Macs only — on a notchless screen it would be a card
    /// dropping over the menu bar out of nowhere. Returns true when a pulse will play.
    @discardableResult
    func demoPulse() -> Bool {
        guard settings.islandMode != .off, metrics(for: targetScreen()).notchWidth > 0 else { return false }
        if panel?.isVisible == true {
            runPulse()
        } else {
            // `.auto` shows the panel on the first loaded snapshot — pulse then. Give up
            // quietly if that never comes; a late surprise pulse is worse than none.
            pendingPulse = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.pendingPulse = false }
        }
        return true
    }

    private func runPulse() {
        guard pendingPulse || panel?.isVisible == true else { return }
        pendingPulse = false
        expand()
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pulseSeconds) { [weak self] in
            guard let self, !self.isHovering else { return }
            self.collapse()
        }
    }

    private func hidePanel() {
        stopSpring()
        resignKeyIfNeeded()
        panel?.orderOut(nil)
        removeMonitors()
        isExpanded = false
        hoverWorkItem?.cancel()
        isHovering = false
    }

    private func makePanel() -> NSPanel {
        // Sized from the same resolver `applyFrame` uses — `NSScreen.main` is the screen
        // with the *key window*, which for an LSUIElement app with no key window is
        // whatever AppKit last decided, not reliably the menu-bar display (N4).
        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: metrics(for: targetScreen()).collapsedSize),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        // One above the menu bar's own status-item plane, so the island always wins
        // the notch-adjacent real estate rather than rendering behind a status item.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hasShadow = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        panel.isMovable = false

        let hosting = NSHostingView(rootView: IslandView(store: store, settings: settings, controller: self))
        hosting.autoresizingMask = [.width, .height]
        panel.contentView = hosting

        return panel
    }

    #if DEBUG
    /// QA harness: the island exactly as it would be framed on the target screen, for
    /// offscreen rendering. No panel, no monitors, no window.
    func debugSnapshot(expanded: Bool) -> (view: AnyView, size: CGSize, screen: NSScreen?) {
        isExpanded = expanded
        let screen = targetScreen()
        metrics = metrics(for: screen)
        return (AnyView(IslandView(store: store, settings: settings, controller: self)), targetSize, screen)
    }

    /// QA harness, live mode: open or close the real panel without a hover.
    func debugSetExpanded(_ expanded: Bool) {
        expanded ? expand() : collapse()
    }
    #endif

    // MARK: - Sizing & placement

    /// Measured, not assumed: the notch is the gap between the two auxiliary top areas
    /// macOS reports, and its height is the top safe-area inset (the menu bar band).
    private func metrics(for screen: NSScreen?) -> IslandMetrics {
        guard let screen,
              let left = screen.auxiliaryTopLeftArea,
              let right = screen.auxiliaryTopRightArea,
              screen.safeAreaInsets.top > 0 else { return .notchless }
        return IslandMetrics(notchWidth: max(0, right.minX - left.maxX), bandHeight: screen.safeAreaInsets.top)
    }

    private var targetSize: CGSize {
        isExpanded ? metrics.expandedSize(loaded: store.snapshot != nil) : metrics.collapsedSize
    }

    /// One resolver, used by both `makePanel` and `applyFrame` (N4 — they disagreed
    /// before, which meant the panel was created at one screen's size and immediately
    /// re-framed for another's).
    ///
    /// Order: the notch display if there is one, since the island's whole shape is built
    /// around that cutout; otherwise the screen that actually owns the menu bar. In
    /// AppKit that is `NSScreen.screens.first` — the screen whose origin is (0,0) — not
    /// `NSScreen.main`, which tracks the key window and is meaningless for an
    /// `LSUIElement` app that usually has none.
    private func targetScreen() -> NSScreen? {
        if let notched = NSScreen.screens.first(where: { $0.auxiliaryTopLeftArea != nil && $0.auxiliaryTopRightArea != nil }) {
            return notched
        }
        return NSScreen.screens.first ?? NSScreen.main
    }

    /// The menu bar's height on a screen with no notch: the gap between the screen's
    /// full frame and the area apps are given. Zero when the menu bar is hidden, which
    /// is exactly when the pill may sit flush with the top edge.
    private func menuBarHeight(on screen: NSScreen) -> CGFloat {
        max(0, screen.frame.maxY - screen.visibleFrame.maxY)
    }

    /// Best-effort "is this screen given over to a full-screen app". The island sits at
    /// `statusBar + 1`, above even the menu bar, so leaving it up would paint a black
    /// pill over full-screen video with no way to dismiss it.
    ///
    /// Geometry, not private API: on a notchless display the menu bar normally reserves
    /// a strip, so `visibleFrame` is shorter than `frame`; in a full-screen Space that
    /// strip is given back. `NSApp.presentationOptions` is deliberately *not* consulted —
    /// it describes this app's own presentation, not the frontmost one's, and would
    /// answer a different question than the one being asked.
    ///
    /// Heuristic, and flagged as such: a user who has set "Automatically hide and show
    /// the menu bar" always looks full-screen by this test, and `visibleFrame`'s
    /// behaviour across Spaces is not contractual. Real-Mac verification is listed in
    /// `mac/CHANGES.md`; a false positive costs a hidden island, never a wrong overlay.
    private func isLikelyFullScreen(_ screen: NSScreen) -> Bool {
        // A notched display always reserves the menu-bar band, so this test does not
        // apply there and the notch region stays ours.
        guard screen.auxiliaryTopLeftArea == nil, screen.auxiliaryTopRightArea == nil else { return false }
        return menuBarHeight(on: screen) == 0
    }

    /// Anchors the panel's *top* edge and horizontal centre — required, not just a
    /// default — so it grows straight down from the notch as it expands, flush against
    /// the screen's top edge in both states, the same shape change a real Dynamic
    /// Island makes.
    private func applyFrame(animated: Bool) {
        guard let panel, let screen = targetScreen() else { return }
        // N4: never paint over a full-screen app. Ordering out here (rather than at the
        // call sites) covers every path into `applyFrame` — hover, click, and the
        // screen-parameter notification that fires when a Space goes full screen.
        guard !isLikelyFullScreen(screen) else {
            stopSpring()
            panel.orderOut(nil)
            return
        }
        let measured = metrics(for: screen)
        if measured != metrics { metrics = measured }
        if !panel.isVisible { panel.orderFrontRegardless() }

        // Reduced motion: the frame jumps and only the content crossfades (0.12s in
        // `IslandView`) — no growth, no overshoot.
        guard animated, !reduceMotion else {
            stopSpring()
            spring.reset(to: isExpanded ? 1 : 0)
            panel.setFrame(frame(progress: spring.value, on: screen), display: true)
            return
        }
        spring.parameters = isExpanded ? Self.expandSpring : Self.collapseSpring
        spring.target = isExpanded ? 1 : 0
        startSpring()
    }

    /// Size interpolated between the collapsed and expanded frames by the spring's
    /// progress — which may overshoot 1 for a moment; the top edge and the horizontal
    /// centre never move, so the island grows straight down out of the notch.
    private func frame(progress: CGFloat, on screen: NSScreen) -> NSRect {
        let from = metrics.collapsedSize
        let to = metrics.expandedSize(loaded: store.snapshot != nil)
        let size = CGSize(
            width: (from.width + (to.width - from.width) * progress).rounded(),
            height: max(from.height, (from.height + (to.height - from.height) * progress).rounded())
        )
        return NSRect(origin: origin(for: size, on: screen), size: size)
    }

    private func startSpring() {
        guard springTimer == nil else { return }
        var last = CACurrentMediaTime()
        // 120Hz ticks: on a 60Hz panel every frame still gets a fresh value; on
        // ProMotion none are skipped. Common mode so a tracking menu doesn't stall it.
        let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] _ in
            // Scheduled on the main run loop, so this is already the main thread; a
            // `Task` hop would cost a frame of latency on every tick.
            MainActor.assumeIsolated {
                guard let self else { return }
                let now = CACurrentMediaTime()
                let settled = self.spring.step(dt: now - last)
                last = now
                if let panel = self.panel, let screen = self.targetScreen() {
                    panel.setFrame(self.frame(progress: self.spring.value, on: screen), display: true)
                }
                if settled { self.stopSpring() }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        springTimer = timer
    }

    private func stopSpring() {
        springTimer?.invalidate()
        springTimer = nil
    }

    private func origin(for size: CGSize, on screen: NSScreen) -> NSPoint {
        let frame = screen.frame
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            // Notched: straddle the cutout, flush with the physical top edge — the pill
            // occupies the dead space either side of the camera housing.
            let notchMidX = (left.maxX + right.minX) / 2
            return NSPoint(x: notchMidX - size.width / 2, y: frame.maxY - size.height)
        }
        // N4, notchless: there is no dead space to occupy here, so sitting flush with the
        // top edge at `statusBar + 1` means covering the menu bar and its status items.
        // Hang the panel *below* the menu bar instead, top-centre.
        let top = frame.maxY - menuBarHeight(on: screen)
        return NSPoint(x: frame.midX - size.width / 2, y: top - size.height)
    }

    // MARK: - Screen changes

    private func installScreenObserverIfNeeded() {
        guard screenObserver == nil else { return }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // A display was added/removed/resized, or the notch's own reported geometry
            // changed (e.g. menu bar auto-hide toggling) — recompute without animating;
            // this isn't a user-driven state change. Explicit hop: the SDK declares this
            // block `@Sendable`, which makes it nonisolated regardless of the queue it is
            // delivered on, and a synchronous call into this @MainActor class from there
            // does not compile. `queue: .main` already makes the hop free.
            Task { @MainActor [weak self] in self?.applyFrame(animated: false) }
        }
    }

    // MARK: - Hover / click / Escape

    private func installMonitorsIfNeeded() {
        guard globalMonitor == nil, localMonitor == nil else { return }
        // Global: mouse only. `.keyDown` is deliberately absent — see the type doc. A
        // global key monitor would require Input Monitoring, which this app does not
        // request and must not; including it anyway would ship a binding that silently
        // never fires.
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown]) { [weak self] event in
            self?.handle(event)
        }
        // Local: the same mouse events plus `.keyDown`, which is delivered here only
        // while the panel actually holds key focus — i.e. after the user clicked it.
        // No permission is involved in receiving your own app's key events.
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .keyDown]) { [weak self] event in
            self?.handle(event)
            return event
        }
    }

    private func removeMonitors() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
    }

    /// Mouse events need no permission, in either monitor. `.keyDown` arrives only from
    /// the *local* monitor and only while the panel is key, which happens solely because
    /// the user clicked it — see the type doc for why there is no global key tap.
    private func handle(_ event: NSEvent) {
        switch event.type {
        case .mouseMoved:
            updateHover(at: NSEvent.mouseLocation)
        case .leftMouseDown:
            guard let panel else { return }
            if panel.frame.contains(NSEvent.mouseLocation) {
                // Take key focus on the explicit click, so Escape has somewhere to be
                // delivered. A `.nonactivatingPanel` becoming key does not activate the
                // app; the user stays in whatever they were doing.
                panel.makeKeyAndOrderFront(nil)
                // A click opens a closed island; a click *inside* an open one belongs to
                // its buttons and must not also close it underneath them.
                if !isExpanded {
                    hoverWorkItem?.cancel()
                    expand()
                }
            } else if isExpanded {
                // N5: click-outside-to-collapse — the permission-free counterpart to
                // Escape, and the gesture people actually reach for first.
                collapse()
            }
        case .keyDown:
            guard isExpanded, event.keyCode == Self.escapeKeyCode else { return }
            collapse()
        default:
            break
        }
    }

    /// Hand focus back once the panel is done with it: a decorative panel holding key
    /// status after it has collapsed would keep swallowing Escape from whatever the user
    /// moved on to.
    private func resignKeyIfNeeded() {
        guard let panel, panel.isKeyWindow else { return }
        panel.resignKey()
        panel.orderFrontRegardless()
    }

    private func updateHover(at point: NSPoint) {
        guard let panel else { return }
        let hovering = panel.frame.contains(point)
        guard hovering != isHovering else { return }
        isHovering = hovering
        hoverWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if hovering { self.expand() } else { self.collapse() }
        }
        hoverWorkItem = workItem
        let delay = hovering ? Self.hoverEnterDelay : Self.hoverExitDelay
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func expand() {
        guard !isExpanded else { return }
        isExpanded = true
        applyFrame(animated: true)
    }

    /// Every route back to collapsed goes through here — hover-out, Escape, click
    /// outside, click on the panel — so key focus is surrendered in exactly one place.
    /// A collapsed decorative pill holding key status would keep eating Escape from
    /// whatever the user moved on to.
    private func collapse() {
        guard isExpanded else { return }
        isExpanded = false
        resignKeyIfNeeded()
        applyFrame(animated: true)
    }
}

/// A damped harmonic oscillator for one scalar (the island's open progress, 0…1),
/// parameterised the way SwiftUI's `spring(response:dampingFraction:)` is so the
/// numbers mean the same thing here as in a view animation. `NSWindow` has no spring
/// API of its own, and the window *is* the island's silhouette, so the frame is stepped
/// by hand. Semi-implicit Euler in fixed 1ms substeps: stable at any tick rate.
@MainActor
final class FrameSpring {
    struct Parameters {
        var response: Double
        var dampingFraction: Double
    }

    var parameters = Parameters(response: 0.4, dampingFraction: 0.8)
    var target: Double = 0
    private(set) var value: Double = 0
    private var velocity: Double = 0

    func reset(to value: Double) {
        self.value = value
        target = value
        velocity = 0
    }

    /// Advances by `dt` seconds; returns true once at rest on the target (and snaps).
    func step(dt: Double) -> Bool {
        let stiffness = pow(2 * .pi / parameters.response, 2)
        let damping = 4 * .pi * parameters.dampingFraction / parameters.response
        var remaining = min(dt, 1.0 / 20.0) // a stalled main thread must not fling it
        let h = 0.001
        while remaining > 0 {
            let step = min(h, remaining)
            let acceleration = -stiffness * (value - target) - damping * velocity
            velocity += acceleration * step
            value += velocity * step
            remaining -= step
        }
        if abs(value - target) < 0.0005, abs(velocity) < 0.005 {
            value = target
            velocity = 0
            return true
        }
        return false
    }
}
