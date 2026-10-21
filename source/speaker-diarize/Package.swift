// swift-tools-version:5.9
import PackageDescription

// Sidecar binary that runs FluidAudio's CoreML-backed speaker diarization
// pipeline and prints segments as JSON to stdout. Spawned by the Rust
// backend after a recording stops; replaces the Rust-bindings approach
// because fluidaudio-rs v0.1.0 doesn't actually expose diarization yet.

let package = Package(
    name: "speaker-diarize",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.4"),
    ],
    targets: [
        .target(name: "DiarizationSupport"),
        // Standalone assertions also run with Command Line Tools, whose SDK
        // does not ship XCTest. This executable is never bundled in the app.
        .executableTarget(
            name: "diarization-support-check",
            dependencies: ["DiarizationSupport", .product(name: "FluidAudio", package: "FluidAudio")],
            path: "Tests/SortformerCompletionChecks"
        ),
        .executableTarget(
            name: "speaker-diarize",
            dependencies: [
                "DiarizationSupport",
                .product(name: "FluidAudio", package: "FluidAudio"),
            ],
            path: "Sources/speaker-diarize"
        )
    ]
)
