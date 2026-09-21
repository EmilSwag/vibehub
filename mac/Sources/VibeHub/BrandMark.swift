import AppKit
import SwiftUI

/// The VibeHub mark — `assets/branding/vibehub-mark.svg` — ported to CoreGraphics so the
/// app needs neither an SVG rasteriser (none ships with macOS or the CI runner) nor an
/// image resource to bundle. Same figure, same numbers: a 48-unit viewBox, three ring
/// arcs of radius 16 stroked at 5 with round caps, a 6.5-radius core and a 4.3-radius
/// satellite sitting on the ring. Ink/paper is `currentColor` in the SVG and the
/// caller's foreground style here, so it flips with the appearance exactly as the
/// SVG's own `prefers-color-scheme` rule does.
///
/// Lumi's first-start review: the welcome step showed an SF Symbol where the real mark
/// belongs. This is the real mark, and it is now also the menu-bar glyph
/// (`BrandMarkImage.menuBar`) and the Island pill's loading glyph, so the product wears
/// one figure everywhere instead of a system chevron in some places and its own mark in
/// others.
///
/// `scripts/make-icon.swift` draws the same figure into the app icon from the same
/// numbers. It is a standalone script and cannot import this module, so the two must be
/// kept in step by hand — the geometry below is the source of truth.
enum BrandMarkGeometry {
    static let viewBox: CGFloat = 48
    static let ringRadius: CGFloat = 16
    static let strokeWidth: CGFloat = 5
    static let coreCenter = CGPoint(x: 24, y: 24)
    static let coreRadius: CGFloat = 6.5
    static let satelliteCenter = CGPoint(x: 37.419, y: 15.286)
    static let satelliteRadius: CGFloat = 4.3

    /// The three ring arcs as (start, end) angles in degrees, y-down like the SVG, each
    /// swept in the increasing direction (the SVG's `sweep-flag="1"`). Derived from the
    /// path endpoints — `M39.757 21.222 → 27.871 39.525`, `M21.222 39.757 → 11.056 14.595`,
    /// `M16 10.144 → 32.947 10.735` — all on the radius-16 circle about (24, 24).
    static let arcs: [(start: CGFloat, end: CGFloat)] = [(-10, 76), (100, 216), (240, 304)]

    /// Degrees per polyline segment. Under a round-capped stroke five units wide, 2°
    /// steps are indistinguishable from a true arc at any size this app draws.
    private static let arcStep: CGFloat = 2

    /// The 48-unit viewBox fitted and centred in `rect`, as (origin, scale).
    private static func fit(_ rect: CGRect) -> (origin: CGPoint, scale: CGFloat) {
        let scale = min(rect.width, rect.height) / viewBox
        let side = viewBox * scale
        return (CGPoint(x: rect.midX - side / 2, y: rect.midY - side / 2), scale)
    }

    /// Sampled polylines rather than `addArc`: the sweep direction is then fixed by the
    /// numbers above, not by which coordinate-system convention a given drawing API
    /// happens to mean by "clockwise". Assumes a y-down context (SwiftUI `Path`, or an
    /// `NSImage` drawn with `flipped: true`).
    static func strokePath(in rect: CGRect) -> CGPath {
        let (origin, scale) = fit(rect)
        let center = CGPoint(x: origin.x + coreCenter.x * scale, y: origin.y + coreCenter.y * scale)
        let radius = ringRadius * scale
        let path = CGMutablePath()
        for arc in arcs {
            var angle = arc.start
            var first = true
            while angle <= arc.end {
                let radians = angle * .pi / 180
                let point = CGPoint(x: center.x + radius * cos(radians), y: center.y + radius * sin(radians))
                if first {
                    path.move(to: point)
                    first = false
                } else {
                    path.addLine(to: point)
                }
                angle += arcStep
            }
        }
        return path
    }

    /// The two filled discs — core and satellite.
    static func fillPath(in rect: CGRect) -> CGPath {
        let (origin, scale) = fit(rect)
        let path = CGMutablePath()
        for (center, radius) in [(coreCenter, coreRadius), (satelliteCenter, satelliteRadius)] {
            path.addEllipse(in: CGRect(
                x: origin.x + (center.x - radius) * scale,
                y: origin.y + (center.y - radius) * scale,
                width: radius * 2 * scale,
                height: radius * 2 * scale
            ))
        }
        return path
    }

    static func lineWidth(in rect: CGRect) -> CGFloat {
        strokeWidth * min(rect.width, rect.height) / viewBox
    }
}

/// The ring arcs, for SwiftUI.
struct BrandMarkStrokes: Shape {
    func path(in rect: CGRect) -> Path {
        Path(BrandMarkGeometry.strokePath(in: rect))
    }
}

/// The core and satellite discs, for SwiftUI.
struct BrandMarkFills: Shape {
    func path(in rect: CGRect) -> Path {
        Path(BrandMarkGeometry.fillPath(in: rect))
    }
}

/// The mark as a SwiftUI view. `style` plays the SVG's `currentColor`: `.primary` by
/// default, so it is ink in Light and paper in Dark; the always-dark Island passes
/// white explicitly because its own colour scheme is pinned rather than inherited.
struct BrandMark: View {
    var size: CGFloat = 34
    var style: AnyShapeStyle = AnyShapeStyle(.primary)

    var body: some View {
        ZStack {
            BrandMarkStrokes()
                .stroke(style, style: StrokeStyle(
                    lineWidth: BrandMarkGeometry.strokeWidth * size / BrandMarkGeometry.viewBox,
                    lineCap: .round
                ))
            BrandMarkFills().fill(style)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("VibeHub")
    }
}

/// The mark as a template `NSImage`, for the one place SwiftUI will only reliably
/// render an image: the `MenuBarExtra` label. Template images are tinted by the menu
/// bar for light/dark and for the highlighted state, exactly as an SF Symbol is.
@MainActor
enum BrandMarkImage {
    /// 18pt — the height a menu-bar glyph gets. Drawn once and cached.
    static let menuBar: NSImage = {
        let side: CGFloat = 18
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            // Colour is irrelevant for a template image (only the alpha channel is
            // used), but a fully opaque stroke and fill is what gives a crisp tint.
            context.setStrokeColor(NSColor.black.cgColor)
            context.setFillColor(NSColor.black.cgColor)
            context.setLineWidth(BrandMarkGeometry.lineWidth(in: rect))
            context.setLineCap(.round)
            context.addPath(BrandMarkGeometry.strokePath(in: rect))
            context.strokePath()
            context.addPath(BrandMarkGeometry.fillPath(in: rect))
            context.fillPath()
            return true
        }
        image.isTemplate = true
        return image
    }()
}
