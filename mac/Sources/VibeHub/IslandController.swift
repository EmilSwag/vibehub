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

    private let settings: AppSettings
    private let store: StatusStore
    private var panel: NSPanel?
    private var cancellables: Set<AnyCancellable> = []

    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var isHovering = false
    private var hoverWorkItem: DispatchWorkItem?
    private var screenObserver: NSObjectProtocol?

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

    private static let expandedSize = CGSize(width: 420, height: 260)
    /// Contract: 60ms before expanding on hover, 250ms before collapsing on hover-out —
    /// asymmetric on purpose (emil design-eng: slow where the user is deciding, fast/
    /// here inverted-fast-to-commit, slow-to-release so a flick across the menu bar
    /// doesn't pop it open, but briefly leaving the card while reading it doesn't snap
    /// it shut either).
    private static let hoverEnterDelay: TimeInterval = 0.06
    private static let hoverExitDelay: TimeInterval = 0.25
    /// Escape key code (`kVK_Escape`); AppKit has no named constant for it.
    private static let escapeKeyCode: UInt16 = 53
    /// Asymmetric on purpose: opening is the moment the user is waiting on, so it gets
    /// the full settle; closing is the system getting out of the way and should be
    /// quicker than the thing it reverses. Sharing one duration made dismissal feel
    /// like the panel was reluctant to leave.
    private static let expandDuration: TimeInterval = 0.35
    private static let collapseDuration: TimeInterval = 0.2
    /// Reduced motion keeps a short crossfade rather than snapping — "reduce" means
    /// gentler and fewer, not none; an instant size jump is more jarring than a fade.
    private static let reducedMotionDuration: TimeInterval = 0.12

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
        let panel = self.panel ?? makePanel()
        self.panel = panel
        isExpanded = false
        // `applyFrame` owns visibility now: it orders the panel out on a full-screen
        // display and front otherwise. Calling `orderFrontRegardless` here as well would
        // undo that decision the instant it was made.
        applyFrame(animated: false)
        installMonitorsIfNeeded()
        installScreenObserverIfNeeded()
    }

    private func hidePanel() {
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
            contentRect: NSRect(origin: .zero, size: collapsedSize(on: targetScreen())),
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

    // MARK: - Sizing & placement

    /// `notchWidth + 168`: wide enough to give the left (presence/time) and right
    /// (tokens/≈$) clusters room on either side of the actual hardware notch, which
    /// this panel deliberately spans rather than avoids. `0` notch width (no-notch
    /// Mac) collapses this to a plain 168pt pill.
    private func collapsedSize(on screen: NSScreen?) -> CGSize {
        guard let screen else { return CGSize(width: 168, height: 32) }
        let width = notchWidth(on: screen) + 168
        let height = screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 32
        return CGSize(width: width, height: height)
    }

    private func notchWidth(on screen: NSScreen) -> CGFloat {
        guard let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else { return 0 }
        return max(0, right.minX - left.maxX)
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
            panel.orderOut(nil)
            return
        }
        if !panel.isVisible { panel.orderFrontRegardless() }

        let size = isExpanded ? Self.expandedSize : collapsedSize(on: screen)
        let frame = NSRect(origin: origin(for: size, on: screen), size: size)
        guard animated else {
            panel.setFrame(frame, display: true)
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            // `spring(response: 0.35, dampingFraction: 0.8)` drives the SwiftUI content
            // (`IslandView`'s `.animation`) directly; `NSAnimationContext` has no spring
            // API of its own (only duration + `CAMediaTimingFunction`, a bezier curve),
            // so the window frame's own motion approximates the same settle time and
            // near-critical damping with a strong ease-out curve instead.
            //
            // Reduced motion still animates, just briefly and linearly: the size change
            // is the information, and removing it entirely turns a settle into a jump.
            if reduceMotion {
                context.duration = Self.reducedMotionDuration
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            } else {
                context.duration = isExpanded ? Self.expandDuration : Self.collapseDuration
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
            }
            panel.animator().setFrame(frame, display: true)
        }
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
                // delivered. `orderFrontRegardless` keeps the panel from activating the
                // app as a whole; the user stays in whatever they were doing.
                panel.makeKeyAndOrderFront(nil)
                toggleExpanded()
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

    private func toggleExpanded() {
        hoverWorkItem?.cancel()
        if isExpanded { collapse() } else { expand() }
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
