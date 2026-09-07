// swift-tools-version:5.7
import PackageDescription

// No dependencies by design (spec): URLSession + Codable only. That keeps CI to a plain
// `swift build` with the preinstalled toolchain — nothing to resolve, nothing to pin.
let package = Package(
    name: "VibeHubMenuBar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "VibeHubMenuBar",
            path: "Sources/VibeHubMenuBar"
        )
    ]
)
