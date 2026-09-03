// swift-tools-version:5.9
import PackageDescription

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
