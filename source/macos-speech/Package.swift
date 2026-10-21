// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "macos-speech",
    platforms: [.macOS(.v13)],
    targets: [.executableTarget(name: "macos-speech", path: "Sources/macos-speech")]
)
