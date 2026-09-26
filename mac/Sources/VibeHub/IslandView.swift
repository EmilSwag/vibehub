import SwiftUI

/// Everything the island's shape and layout are measured from, derived once per screen
/// by `IslandController` and shared by the panel frame and the SwiftUI content so the
/// two can never disagree.
///
/// Anatomy, collapsed, on a notched display:
///
///     ╮┌──────── wing ───────┬──── notch ────┬─────── wing ────────┐╭
///      │ ● 2h 14m            │  (camera)     │          1.3M $3.20 │
///      ╰─────────────────────┴───────────────┴─────────────────────╯
///
/// The body is exactly as tall as the hardware notch and straddles it, so the camera
/// housing disappears into it; the concave *shoulders* flare the top corners out into
/// the menu bar edge the way the notch itself meets the bezel; content lives only in
/// the wings. On a display without a notch `notchWidth` is 0 and the same shape hangs
/// from the bottom of the menu bar.
struct IslandMetrics: Equatable {
    var notchWidth: CGFloat
    var bandHeight: CGFloat

    /// Content room either side of the camera housing.
    static let wing: CGFloat = 100
    /// Concave top-corner flare. Kept constant through the animation so the content
    /// inset never shifts while the window springs.
    static let shoulder: CGFloat = 6
    /// Matches the hardware notch's own lower corners, so the pill reads as the notch
    /// grown sideways rather than a second object stuck to it.
    static let collapsedBottomRadius: CGFloat = 10
    static let expandedBottomRadius: CGFloat = 24
    static let expandedWidth: CGFloat = 404
    static let bodyHeightLoaded: CGFloat = 248
    static let bodyHeightMessage: CGFloat = 92

    /// No notch: a plain menu-bar-height tab, same proportions.
    static let notchless = IslandMetrics(notchWidth: 0, bandHeight: 28)

    var collapsedSize: CGSize {
        CGSize(width: notchWidth + 2 * Self.wing + 2 * Self.shoulder, height: bandHeight)
    }

    func expandedSize(loaded: Bool) -> CGSize {
        CGSize(
            width: max(Self.expandedWidth, collapsedSize.width),
            height: bandHeight + (loaded ? Self.bodyHeightLoaded : Self.bodyHeightMessage)
        )
    }
}

/// Notch silhouette: concave shoulders at the top, rounded lower corners. Quadratic
/// Béziers whose control points sit on the sharp corners they replace — at these radii
/// that is visually a circular arc, with no winding-direction bookkeeping.
struct IslandShape: Shape {
    var shoulder: CGFloat
    var bottomRadius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(shoulder, bottomRadius) }
        set { shoulder = newValue.first; bottomRadius = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        let s = min(shoulder, rect.width / 4)
        let r = max(0, min(bottomRadius, (rect.width - 2 * s) / 2, rect.height - s))
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.minX + s, y: rect.minY + s), control: CGPoint(x: rect.minX + s, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX + s, y: rect.maxY - r))
        path.addQuadCurve(to: CGPoint(x: rect.minX + s + r, y: rect.maxY), control: CGPoint(x: rect.minX + s, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX - s - r, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - s, y: rect.maxY - r), control: CGPoint(x: rect.maxX - s, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX - s, y: rect.minY + s))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY), control: CGPoint(x: rect.maxX - s, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

/// The panel's content. The panel *window* is what springs (`IslandController`); this
/// view just fills whatever frame it is given:
///
/// - the shape fills the window, its lower radius eased from notch-sized to card-sized
///   by how far the window has grown, so the silhouette morphs rather than swaps;
/// - the band (the collapsed content) never moves or fades — it stays pinned beside the
///   notch while the body is revealed beneath it, the way a Dynamic Island keeps its
///   live activity in place as it opens;
/// - the body is laid out at full expanded size from the start and simply uncovered by
///   the growing window, then faded in, so nothing reflows mid-spring.
///
/// Pure black, not 92%: anything lighter than the camera housing shows the hardware
/// notch as a darker rectangle inside the island. Always dark, like the notch itself.
struct IslandView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var controller: IslandController
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let metrics = controller.metrics
        GeometryReader { proxy in
            let collapsed = metrics.collapsedSize
            let target = metrics.expandedSize(loaded: store.snapshot != nil)
            let span = max(1, target.height - collapsed.height)
            let t = min(1, max(0, (proxy.size.height - collapsed.height) / span))
            let shape = IslandShape(
                shoulder: IslandMetrics.shoulder,
                bottomRadius: IslandMetrics.collapsedBottomRadius
                    + (IslandMetrics.expandedBottomRadius - IslandMetrics.collapsedBottomRadius) * t
            )
            ZStack(alignment: .top) {
                shape.fill(Color.black)
                VStack(spacing: 0) {
                    IslandBand(store: store, metrics: metrics, expanded: controller.isExpanded)
                    IslandBody(store: store, settings: settings)
                        .frame(width: target.width - 2 * IslandMetrics.shoulder, height: target.height - metrics.bandHeight, alignment: .top)
                        .opacity(controller.isExpanded ? 1 : 0)
                        .scaleEffect(controller.isExpanded || reduceMotion ? 1 : 0.97, anchor: .top)
                        .animation(bodyAnimation, value: controller.isExpanded)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
            }
            .clipShape(shape)
        }
        .environment(\.colorScheme, .dark)
    }

    /// In: a beat after the window starts to grow, so the text arrives into space that
    /// already exists. Out: immediately and quicker, so it is gone before the edges pass it.
    private var bodyAnimation: Animation {
        if reduceMotion { return .easeOut(duration: 0.12) }
        return controller.isExpanded ? .easeOut(duration: 0.22).delay(0.07) : .easeIn(duration: 0.1)
    }
}

/// The collapsed content: two wings, one either side of the camera housing, and a
/// fixed gap exactly the notch's width between them — nothing is ever drawn under it.
///
/// Open, the card below already prints today's numbers with labels, so the wings swap
/// to who and how — avatar and name, presence in words — instead of repeating them.
struct IslandBand: View {
    @ObservedObject var store: StatusStore
    let metrics: IslandMetrics
    var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ZStack(alignment: .leading) {
                leading.opacity(showIdentity ? 0 : 1)
                if let me = store.snapshot {
                    identity(me).opacity(showIdentity ? 1 : 0)
                }
            }
            .padding(.leading, 12)
            .frame(width: IslandMetrics.wing, alignment: .leading)
            Color.clear.frame(width: metrics.notchWidth)
            ZStack(alignment: .trailing) {
                trailing.opacity(showIdentity ? 0 : 1)
                if let me = store.snapshot {
                    Text(Format.statusLabel(me.presence.status))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .fixedSize()
                        .opacity(showIdentity ? 1 : 0)
                }
            }
            .padding(.trailing, 12)
            .frame(width: IslandMetrics.wing, alignment: .trailing)
        }
        .frame(height: metrics.bandHeight)
        .foregroundStyle(.white)
        .animation(reduceMotion ? .easeOut(duration: 0.12) : .easeInOut(duration: 0.2), value: showIdentity)
    }

    private var showIdentity: Bool { expanded && store.snapshot != nil }

    private func identity(_ me: TrackerMe) -> some View {
        let name = me.user.displayName ?? me.user.username
        return HStack(spacing: 6) {
            Avatar(url: me.user.avatarUrl, name: name, size: 18)
            Text(name.split(separator: " ").first.map(String.init) ?? name)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private var leading: some View {
        if let me = store.snapshot {
            // Live: the same `liveActiveSeconds` tick the popover and menu bar use.
            HStack(spacing: 6) {
                PresenceDot(status: me.presence.status, size: 7)
                Text(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds))
                    .font(.system(size: 12, weight: .semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize()
            }
        } else {
            // The app's own mark stands in for presence until there is one; dimmed
            // when the problem is the connection, not the account.
            BrandMark(size: 14, style: AnyShapeStyle(Color.white.opacity(store.phase == .loading || store.phase == .needsToken ? 0.9 : 0.45)))
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch store.phase {
        case .loaded(let me):
            // Live timer on the left wing; fresh tokens + ≈$ here. No verified price →
            // no ≈$ at all in the pill (never guess, never "$0.00").
            HStack(spacing: 5) {
                Text(Format.optionalCount(me.today.tokens))
                    .accessibilityLabel(me.today.tokens.map { "\(Format.compactCount($0)) tokens" } ?? Format.tokensLabel(nil))
                if let usd = me.today.estimatedUsd {
                    Text("\u{2248}" + Format.compactUsd(usd))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .accessibilityLabel("about \(Format.compactUsd(usd))")
                }
            }
            .font(.system(size: 12, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(Color.white.opacity(0.85))
            .lineLimit(1)
            .fixedSize()
        case .loading:
            Capsule().fill(Color.white.opacity(0.18)).frame(width: 30, height: 6)
        case .needsToken:
            Text("Sign in")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.6))
                .fixedSize()
        case .failed:
            Image(systemName: "wifi.slash")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.55))
                .accessibilityLabel("Offline")
        }
    }
}

/// What the island shows once open. Your own name is not here — it is your Mac — so the
/// card spends its room on now, today and friends.
struct IslandBody: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings

    var body: some View {
        Group {
            switch store.phase {
            case .loaded(let me):
                loaded(me)
            case .loading:
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(width: 220, height: 11)
                    SkeletonBar(width: 120, height: 9)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .needsToken:
                message(symbol: "person.crop.circle.badge.plus", title: "Not connected", detail: "Click VibeHub in the menu bar.")
            case .failed:
                message(symbol: "wifi.slash", title: "Can\u{2019}t reach VibeHub", detail: "Retrying on its own.")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 14)
    }

    private func loaded(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            now(me)
            today(me)
            friends(me)
            Spacer(minLength: 0)
            footer
        }
    }

    private func now(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionLabel(text: "Now")
            if let activity = me.presence.activity {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Format.activityLine(activity))
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    Text(Format.elapsedShort(since: activity.since, now: store.now))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .fixedSize()
                }
            } else {
                Text(me.tracker.connected ? "Nothing open right now." : "Not counting on this Mac.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// The ≈$ slot is always present — an em-dash when there is no verified price,
    /// never $0.00 and never a missing column that changes the row's shape.
    private func today(_ me: TrackerMe) -> some View {
        HStack(alignment: .top, spacing: 0) {
            stat(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds), "active today")
            stat(Format.optionalCount(me.today.tokens), Format.cachedLine(me.today.cachedTokens).map { "tokens \u{00B7} \($0)" } ?? Format.tokensLabel(me.today.tokens))
            stat(Format.optionalUsd(me.today.estimatedUsd), "\u{2248} spend")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit()
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Three at most: the card's height is fixed so the window has a spring target.
    private func friends(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            SectionLabel(text: me.friendsOnline.count == 1 ? "1 friend online" : "\(me.friendsOnline.count) friends online")
            if me.friendsOnline.sample.isEmpty {
                Text("Nobody\u{2019}s coding right now.").font(.system(size: 12)).foregroundStyle(.secondary)
            } else {
                ForEach(me.friendsOnline.sample.prefix(3)) { friend in
                    HStack(spacing: 7) {
                        Avatar(url: friend.avatarUrl, name: friend.displayName ?? friend.username, size: 18)
                        Text(friend.displayName ?? friend.username)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        PresenceDot(status: friend.status, size: 6)
                        Spacer(minLength: 8)
                        if let activity = friend.activity {
                            Text(Format.toolLabel(activity.tool))
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    /// Popover-only: token, sign-out and Quit — an always-on-top panel is the wrong
    /// place for account management.
    private var footer: some View {
        HStack(spacing: 6) {
            IslandButton(title: "Open VibeHub", symbol: "arrow.up.right") {
                NSWorkspace.shared.open(settings.webUrl)
            }
            IslandButton(title: "Settings", symbol: "gearshape") {
                NSWorkspace.shared.open(settings.webUrl.appendingPathComponent("settings"))
            }
            Spacer(minLength: 0)
        }
    }

    private func message(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }
}

/// A quiet capsule button for the dark card: hover is a lightness step, never a hue.
private struct IslandButton: View {
    let title: String
    let symbol: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 10, weight: .semibold))
                Text(title).font(.system(size: 12, weight: .medium))
            }
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Capsule().fill(Color.white.opacity(hovering ? 0.16 : 0.09)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.white.opacity(0.9))
        .onHover { hovering = $0 }
    }
}
