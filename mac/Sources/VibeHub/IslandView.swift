import SwiftUI

/// Bottom-only rounded corners via a hand-built `Shape`, not `UnevenRoundedRectangle`
/// (SwiftUI only gained per-corner radii in macOS 14/iOS 17 — this app's minimum is
/// macOS 13). A quadratic Bézier from each straight edge into the corner, with the
/// control point placed exactly at the sharp corner it's replacing, reads as a normal
/// rounded corner at these radii without needing arc-angle/winding-direction math.
/// `AnyTransition.modifier` needs a concrete `ViewModifier`; `.blur` alone isn't one.
/// Separate type rather than a closure so the transition can be built in both the
/// active and identity directions from the same shape.
struct BlurModifier: ViewModifier {
    let radius: CGFloat

    func body(content: Content) -> some View {
        content.blur(radius: radius)
    }
}

struct BottomRoundedRectangle: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let r = min(radius, min(rect.width, rect.height) / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - r, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - r),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.closeSubpath()
        return path
    }
}

/// Content for the floating panel, in both states, plus the onboarding "Done" step's
/// static preview (`IslandPreview` below) — same shapes and the same shared components
/// as `PopoverView` (`Avatar`, `PresenceDot`, `SectionLabel`, `Format`), because this is
/// a second window onto the same data, not a second design. The four data sections
/// (header/Now/Today/friends) and the shared components are reused as-is; the
/// *container* views are Island's own, not literally `PopoverView`'s private view
/// builders, because Island is always dark regardless of system appearance while the
/// popover follows it — sharing those methods directly would need a colour-scheme
/// parameter threaded through `PopoverView` itself, which is out of scope here.
///
/// Always dark, regardless of the system appearance: like the hardware notch it hugs,
/// the island reads as a fixed black plate in both light and dark mode — `PresenceDot`/
/// `SectionLabel`'s `.secondary`/`.tertiary` foreground styles need `.preferredColorScheme
/// (.dark)` here so they resolve to their dark-appropriate (light-on-dark) values even
/// when the rest of the system is in Light mode.
///
/// Bottom corners only: the panel is flush against the screen's top edge in both
/// states (`IslandController` anchors it there), so rounding the top corners would look
/// like the shape floating above its own cut line instead of growing out of it.
struct IslandView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var controller: IslandController
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if controller.isExpanded {
                expanded.transition(contentTransition)
            } else {
                IslandPill(store: store).transition(contentTransition)
            }
        }
        .background(shape.fill(Color.black.opacity(0.92)))
        .clipShape(shape)
        .preferredColorScheme(.dark)
        .animation(contentAnimation, value: controller.isExpanded)
    }

    /// Never from `scale(0)`: nothing in the physical world appears out of nothing, and
    /// a card unfolding from a zero-size point reads as a glitch rather than a growth.
    /// 0.95 is enough to imply the motion and small enough not to look like a bounce.
    ///
    /// The blur is doing real work, not decoration. Without it a crossfade shows two
    /// legible-but-different layouts overlapping — the pill's two clusters and the card's
    /// header — and the eye resolves that as two objects swapping. 2pt is enough to stop
    /// either being readable mid-transition, so the pair reads as one shape changing.
    /// Kept at 2pt because blur is expensive and this runs over whatever is underneath.
    private var contentTransition: AnyTransition {
        if reduceMotion {
            // Reduced motion: opacity only. The size change is still visible (the window
            // frame animates, briefly, in IslandController) but nothing scales or blurs.
            return .opacity
        }
        return .opacity.combined(with: .scale(scale: 0.95)).combined(with: .modifier(
            active: BlurModifier(radius: 2),
            identity: BlurModifier(radius: 0)
        ))
    }

    /// Contract: `spring(response: 0.35, dampingFraction: 0.8)` for the content swap;
    /// `NSAnimationContext` (`IslandController.applyFrame`) drives the window frame
    /// itself, since `NSWindow` has no spring API of its own — see the comment there.
    ///
    /// Collapse is quicker than expand, matching the window-frame durations on the
    /// controller side: opening is what the user is waiting for, closing is the panel
    /// getting out of the way and should not be savoured.
    private var contentAnimation: Animation {
        if reduceMotion { return .easeOut(duration: 0.12) }
        return controller.isExpanded
            ? .spring(response: 0.35, dampingFraction: 0.8)
            : .spring(response: 0.2, dampingFraction: 0.9)
    }

    private var shape: BottomRoundedRectangle {
        BottomRoundedRectangle(radius: 16)
    }

    private var expanded: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch store.phase {
            case .loaded(let me):
                header(me)
                Divider().overlay(Color.white.opacity(0.15))
                nowRow(me)
                todayRow(me)
                friendsRow(me)
                Spacer(minLength: 0)
                Divider().overlay(Color.white.opacity(0.15))
                footer
            case .loading:
                // Shape-matched to the loaded state: an avatar-sized circle and two
                // bars where the name and the Now line will land, so nothing jumps
                // sideways when real data replaces it.
                loadingSkeleton
            case .needsToken:
                // Previously shared the `.loading` branch, which left a signed-out user
                // watching a skeleton that could never resolve. This is a terminal
                // state with an action, not a wait.
                statusMessage(
                    symbol: "person.crop.circle.badge.plus",
                    title: "Not connected",
                    detail: "Open VibeHub from the menu bar to add your token."
                )
            case .failed:
                statusMessage(
                    symbol: "antenna.radiowaves.left.and.right.slash",
                    title: "Can't reach VibeHub",
                    detail: "Retrying on its own."
                )
            }
        }
        .padding(14)
        .frame(width: 420, height: 260, alignment: .topLeading)
    }

    /// Same geometry as `header` + `nowRow`, so the transition from skeleton to content
    /// is a fill, not a relayout.
    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(Color.white.opacity(0.12)).frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 4) {
                    SkeletonBar(width: 120, height: 11)
                    SkeletonBar(width: 64, height: 9)
                }
                Spacer(minLength: 0)
            }
            SectionLabel(text: "Now")
            SkeletonBar(width: 220, height: 11)
            SkeletonBar(width: 70, height: 9)
        }
    }

    /// One shape for every terminal non-loaded state, each with its own symbol and its
    /// own sentence — `needsToken` and `failed` are different problems and must not look
    /// like the same one (or like loading).
    private func statusMessage(symbol: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(.secondary)
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            }
            Text(detail)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func header(_ me: TrackerMe) -> some View {
        HStack(spacing: 8) {
            Avatar(url: me.user.avatarUrl, name: me.user.displayName ?? me.user.username, size: 28)
            Text(me.user.displayName ?? me.user.username)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            PresenceDot(status: me.presence.status)
            Spacer(minLength: 0)
        }
    }

    /// Live: the elapsed-since-activity-started line ticks off `store.now` exactly
    /// like `PopoverView.nowBlock` — this is one of the "live timers" the panel needs,
    /// alongside `todayRow`'s ticking "active" stat and the collapsed pill's own time.
    private func nowRow(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionLabel(text: "Now")
            if let activity = me.presence.activity {
                Text(Format.activityLine(activity)).font(.system(size: 12)).foregroundStyle(.white).lineLimit(1)
                Text(Format.elapsedShort(since: activity.since, now: store.now))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            } else {
                Text(me.tracker.connected ? "Nothing open right now." : "Tracker offline.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// The ≈$ slot is always present. A null `estimatedUsd` means "today's models have
    /// no verified price", which renders as an em-dash — not as `$0.00` (a false claim
    /// that the work was free) and not by dropping the column (which would make the row
    /// change shape depending on which models someone used).
    private func todayRow(_ me: TrackerMe) -> some View {
        HStack(spacing: 16) {
            stat(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds), "active")
            // Nullable on the wire (checkpoint §M.1); B7 wording when null — "tokens not
            // reported", never 0, never an estimate.
            stat(Format.optionalCount(me.today.tokens), Format.tokensLabel(me.today.tokens))
            stat(Format.optionalUsd(me.today.estimatedUsd), "\u{2248}$")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 13, weight: .medium)).foregroundStyle(.white).monospacedDigit()
            Text(label).font(.system(size: 9)).foregroundStyle(.tertiary)
        }
    }

    /// Names and tools, not just avatars — mirrors `PopoverView.friendsBlock`.
    /// `.prefix(3)`, tighter than the popover's uncapped list: this card's total
    /// height is fixed at 260, and each named row costs more vertical space than the
    /// small overlapping-avatar strip this replaced.
    private func friendsRow(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionLabel(text: "Friends online: \(me.friendsOnline.count)")
            if me.friendsOnline.sample.isEmpty {
                Text("Nobody's coding right now.").font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                ForEach(me.friendsOnline.sample.prefix(3)) { friend in
                    HStack(spacing: 6) {
                        Avatar(url: friend.avatarUrl, name: friend.displayName ?? friend.username, size: 18)
                        Text(friend.displayName ?? friend.username)
                            .font(.system(size: 11))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        PresenceDot(status: friend.status, size: 6)
                        Spacer(minLength: 0)
                        if let activity = friend.activity {
                            Text(Format.toolLabel(activity.tool))
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    /// Deliberately not `PopoverView`'s full action list: "Copy tracker token" and
    /// "Quit" stay popover-only — a decorative always-on-top panel is the wrong place
    /// to expose sign-out/quit.
    private var footer: some View {
        HStack(spacing: 16) {
            footerButton("Open VibeHub", symbol: "arrow.up.forward.app") {
                NSWorkspace.shared.open(settings.webUrl)
            }
            footerButton("Settings", symbol: "gearshape") {
                NSWorkspace.shared.open(settings.webUrl.appendingPathComponent("settings"))
            }
            Spacer(minLength: 0)
        }
    }

    private func footerButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 11))
                Text(title).font(.system(size: 11))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white.opacity(0.85))
    }
}

/// The collapsed, notch-hugging pill: left cluster is presence + today's time, right
/// cluster is tokens (plus ≈$ once the server sends it) — flanking the actual hardware
/// notch, which sits in the flexible gap between them. The panel's own width is exactly
/// `notch width + 168` (`IslandController.collapsedSize`), so filling it edge-to-edge
/// here (rather than sizing to fit) is what keeps the two clusters correctly straddling
/// the notch instead of drifting to one side.
struct IslandPill: View {
    @ObservedObject var store: StatusStore

    var body: some View {
        HStack(spacing: 0) {
            switch store.phase {
            case .loaded(let me):
                leftCluster(me)
                Spacer(minLength: 0)
                rightCluster(me)
            case .loading, .needsToken, .failed:
                // One glyph for all three read as "something is wrong, or maybe not" —
                // at pill size the symbol is the entire message, so each state gets its
                // own. Dimmed for the two that need the user, full strength while
                // loading, since only one of them is a problem.
                Spacer(minLength: 0)
                if store.phase == .loading {
                    // The app's own mark (Lumi: the real mark, not a system chevron),
                    // full strength — loading is not a problem state.
                    BrandMark(size: 12, style: AnyShapeStyle(.white))
                } else {
                    Image(systemName: placeholderSymbol)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }

    /// Distinct per state (Lumi): the app mark while loading (drawn by `BrandMark`, not
    /// listed here), a "add your account" badge when there is no token, a struck-through
    /// antenna when the server is unreachable — matching the symbols the expanded card
    /// uses for the same states, so hovering explains the pill rather than introducing a
    /// new vocabulary.
    private var placeholderSymbol: String {
        switch store.phase {
        case .needsToken: return "person.crop.circle.badge.plus"
        case .failed: return "antenna.radiowaves.left.and.right.slash"
        case .loading, .loaded: return "circle.dotted"
        }
    }

    /// Live: same `store.liveActiveSeconds` tick the popover's Today stat uses.
    private func leftCluster(_ me: TrackerMe) -> some View {
        HStack(spacing: 5) {
            PresenceDot(status: me.presence.status, size: 6)
            Text(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds))
                .font(.system(size: 11, weight: .medium))
                .monospacedDigit()
        }
    }

    private func rightCluster(_ me: TrackerMe) -> some View {
        HStack(spacing: 5) {
            // Nullable (checkpoint §M.1): the pill has no room for B7's words, so the
            // slot shows the same em-dash the ≈$ slot uses and the accessibility label
            // carries "tokens not reported"; the expanded card and the popover spell it out.
            Text(Format.optionalCount(me.today.tokens))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .accessibilityLabel(me.today.tokens.map { "\(Format.compactCount($0)) tokens" } ?? Format.tokensLabel(nil))
            // Same rule as the expanded card: an em-dash when today's models have no
            // verified price, never a fabricated $0.00.
            Text(Format.optionalUsd(me.today.estimatedUsd))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }
}

/// Non-interactive taste of the collapsed pill, for the onboarding "Done" step. Fixed
/// 168pt width there (no real screen/notch to measure against in that context).
struct IslandPreview: View {
    @ObservedObject var store: StatusStore

    var body: some View {
        IslandPill(store: store)
            .frame(width: 168, height: 32)
            .background(BottomRoundedRectangle(radius: 16).fill(Color.black.opacity(0.92)))
            .clipShape(BottomRoundedRectangle(radius: 16))
            .preferredColorScheme(.dark)
    }
}
