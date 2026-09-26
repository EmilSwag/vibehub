import AppKit
import SwiftUI

/// The one-time "VibeHub lives up here" pointer shown after first connect, hanging
/// under the app's menu bar item — so the window closing doesn't read as the app
/// vanishing. Gone after a few seconds or on click; never shown twice
/// (`AppSettings.hasShownMenuBarHint`).
@MainActor
final class MenuBarHint {
    private var panel: NSPanel?
    private static let visibleSeconds: TimeInterval = 5
    private static let size = CGSize(width: 220, height: 64)

    func showOnce(settings: AppSettings) {
        guard !settings.hasShownMenuBarHint else { return }
        settings.hasShownMenuBarHint = true
        show()
    }

    func show() {
        guard panel == nil else { return }
        let anchor = Self.statusItemFrame()
        let screen = anchor.flatMap { frame in NSScreen.screens.first { $0.frame.intersects(frame) } }
            ?? NSScreen.screens.first
        guard let screen else { return }

        // Centre under the item, clamped on-screen; fall back to the top-right corner.
        let top = anchor?.minY ?? (screen.frame.maxY - (screen.frame.maxY - screen.visibleFrame.maxY))
        let midX = anchor?.midX ?? (screen.frame.maxX - 140)
        var x = midX - Self.size.width / 2
        x = min(max(x, screen.frame.minX + 8), screen.frame.maxX - Self.size.width - 8)
        let arrowX = midX - x

        let panel = NSPanel(
            contentRect: NSRect(x: x, y: top - Self.size.height - 2, width: Self.size.width, height: Self.size.height),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.contentView = NSHostingView(rootView: MenuBarHintView(arrowX: arrowX) { [weak self] in self?.dismiss() })
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        self.panel = panel

        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().alphaValue = 1
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.visibleSeconds) { [weak self] in self?.dismiss() }
    }

    func dismiss() {
        guard let panel else { return }
        self.panel = nil
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.25
            panel.animator().alphaValue = 0
        }, completionHandler: {
            panel.orderOut(nil)
        })
    }

    /// `MenuBarExtra` doesn't hand out its `NSStatusItem`, but its button lives in this
    /// app's own status-bar window — the one window of ours sitting in the menu bar.
    private static func statusItemFrame() -> NSRect? {
        NSApp.windows
            .filter { String(describing: type(of: $0)).contains("StatusBarWindow") && $0.isVisible }
            .map(\.frame)
            .first { $0.width > 0 && $0.width < 400 }
    }
}

struct MenuBarHintView: View {
    /// Where the arrow points, in the bubble's own coordinates.
    var arrowX: CGFloat
    var onTap: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            Triangle()
                .fill(Color(nsColor: .windowBackgroundColor))
                .frame(width: 16, height: 8)
                .offset(x: min(max(arrowX, 18), 202) - 110)
            HStack(spacing: 8) {
                BrandMark(size: 16)
                Text("VibeHub lives up here")
                    .font(.system(size: 13, weight: .semibold))
                    .fixedSize()
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(nsColor: .windowBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
        }
        .frame(width: 220, height: 64)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
