#!/usr/bin/env swift
//
// Draws the monochrome app icon straight into an .iconset directory.
//
//   swift scripts/make-icon.swift <path/to/AppIcon.iconset>
//
// Why generate rather than commit a binary: this needs no SVG rasteriser (none is
// preinstalled on a GitHub runner), keeps no opaque blob in git, and the icon stays
// editable as code. AppKit + CoreGraphics only — both already on every macOS runner.
//
// The figure is the VibeHub brand mark (assets/branding/vibehub-mark.svg), the same
// numbers as Sources/VibeHub/BrandMark.swift — that file is the source of truth and
// this script cannot import it, so the two are kept in step by hand. Earlier builds
// drew a `</>` chevron here, which was not the mark (Lumi's review); every surface —
// icon, menu bar, onboarding, Island — now wears the same figure.

import AppKit
import Foundation

// MARK: - Brand mark geometry (mirror of BrandMarkGeometry in BrandMark.swift)

let markViewBox: CGFloat = 48
let markRingRadius: CGFloat = 16
let markStrokeWidth: CGFloat = 5
let markCoreCenter = CGPoint(x: 24, y: 24)
let markCoreRadius: CGFloat = 6.5
let markSatelliteCenter = CGPoint(x: 37.419, y: 15.286)
let markSatelliteRadius: CGFloat = 4.3
/// (start, end) in degrees, y-down like the SVG, swept in the increasing direction.
let markArcs: [(start: CGFloat, end: CGFloat)] = [(-10, 76), (100, 216), (240, 304)]
let markArcStep: CGFloat = 2

/// Rounded-rect plate plus the brand mark, in greyscale only.
func drawIcon(pixels: Int) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { return nil }

    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    guard let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
    NSGraphicsContext.current = context

    let size = CGFloat(pixels)
    let unit = size / 1024.0

    // Plate. Inset slightly so the shape reads at 16pt, with macOS's ~22.4% corner ratio.
    let inset = 64 * unit
    let plate = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = plate.width * 0.2237
    NSColor(calibratedWhite: 0.10, alpha: 1.0).setFill()
    NSBezierPath(roundedRect: plate, xRadius: radius, yRadius: radius).fill()

    // Mark. The 48-unit viewBox spans 62.5% of the canvas, centred — the stroke lands
    // at ~67px on the 1024 master, close to what the previous glyph used, so the icon
    // keeps its weight at 16pt. This bitmap context is y-up; the SVG (and
    // BrandMark.swift) are y-down, so `point` flips y once, here.
    let box = 640 * unit
    let scale = box / markViewBox
    let originX = (size - box) / 2
    let originY = (size - box) / 2
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
        NSPoint(x: originX + x * scale, y: originY + (markViewBox - y) * scale)
    }

    // Ring arcs as sampled polylines under a round-capped stroke — the sweep direction
    // is then fixed by the numbers, not by AppKit's notion of "clockwise".
    let ring = NSBezierPath()
    ring.lineWidth = markStrokeWidth * scale
    ring.lineCapStyle = .round
    ring.lineJoinStyle = .round
    for arc in markArcs {
        var angle = arc.start
        var first = true
        while angle <= arc.end {
            let radians = angle * .pi / 180
            let p = point(markCoreCenter.x + markRingRadius * cos(radians), markCoreCenter.y + markRingRadius * sin(radians))
            if first {
                ring.move(to: p)
                first = false
            } else {
                ring.line(to: p)
            }
            angle += markArcStep
        }
    }
    NSColor(calibratedWhite: 0.97, alpha: 1.0).setStroke()
    ring.stroke()

    // Core and satellite discs.
    let discs = NSBezierPath()
    for (center, r) in [(markCoreCenter, markCoreRadius), (markSatelliteCenter, markSatelliteRadius)] {
        let c = point(center.x, center.y)
        discs.appendOval(in: NSRect(x: c.x - r * scale, y: c.y - r * scale, width: r * 2 * scale, height: r * 2 * scale))
    }
    NSColor(calibratedWhite: 0.97, alpha: 1.0).setFill()
    discs.fill()

    return rep.representation(using: .png, properties: [:])
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write("usage: make-icon.swift <AppIcon.iconset>\n".data(using: .utf8)!)
    exit(2)
}

let outputDirectory = URL(fileURLWithPath: arguments[1])

// Top-level script code can't let errors propagate — they have to be handled here.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write("make-icon: \(message)\n".data(using: .utf8)!)
    exit(1)
}

do {
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
} catch {
    fail("could not create \(outputDirectory.path): \(error.localizedDescription)")
}

// The exact set `iconutil` expects; anything missing makes it refuse the folder.
let variants: [(name: String, pixels: Int)] = [
    ("icon_16x16", 16),
    ("icon_16x16@2x", 32),
    ("icon_32x32", 32),
    ("icon_32x32@2x", 64),
    ("icon_128x128", 128),
    ("icon_128x128@2x", 256),
    ("icon_256x256", 256),
    ("icon_256x256@2x", 512),
    ("icon_512x512", 512),
    ("icon_512x512@2x", 1024),
]

for variant in variants {
    guard let data = drawIcon(pixels: variant.pixels) else { fail("failed to render \(variant.name)") }
    do {
        try data.write(to: outputDirectory.appendingPathComponent("\(variant.name).png"))
    } catch {
        fail("could not write \(variant.name).png: \(error.localizedDescription)")
    }
}

print("wrote \(variants.count) icon variants to \(outputDirectory.path)")
