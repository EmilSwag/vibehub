#!/usr/bin/env swift
//
// Draws the monochrome app icon straight into an .iconset directory.
//
//   swift scripts/make-icon.swift <path/to/AppIcon.iconset>
//
// Why generate rather than commit a binary: this needs no SVG rasteriser (none is
// preinstalled on a GitHub runner), keeps no opaque blob in git, and the icon stays
// editable as code. AppKit + CoreGraphics only — both already on every macOS runner.

import AppKit
import Foundation

/// Rounded-rect plate plus a `</>` mark, in greyscale only.
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

    // `</>` mark. Normalised coordinates so every size is the same drawing.
    let mark = NSBezierPath()
    mark.lineWidth = 62 * unit
    mark.lineCapStyle = .round
    mark.lineJoinStyle = .round
    let point = { (x: CGFloat, y: CGFloat) in NSPoint(x: x * size, y: y * size) }

    mark.move(to: point(0.40, 0.66))
    mark.line(to: point(0.28, 0.50))
    mark.line(to: point(0.40, 0.34))

    mark.move(to: point(0.60, 0.66))
    mark.line(to: point(0.72, 0.50))
    mark.line(to: point(0.60, 0.34))

    mark.move(to: point(0.545, 0.30))
    mark.line(to: point(0.455, 0.70))

    NSColor(calibratedWhite: 0.97, alpha: 1.0).setStroke()
    mark.stroke()

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
