import Foundation
import FluidAudio
import DiarizationSupport

struct CheckFailure: Error { let message: String }
func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw CheckFailure(message: message) }
}
func rejects(_ action: () throws -> Void, _ message: String) throws {
    do { try action() } catch { return }
    throw CheckFailure(message: message)
}
let config = SortformerConfig.highContextV2_1
let core = config.coreFrames * config.melStride
let right = config.chunkRightContext * config.subsamplingFactor * config.melStride
func plan(_ samples: Int) throws -> SortformerCompletion {
    try SortformerCompletion(sampleCount: samples, sampleRate: config.sampleRate,
        coreSamples: core, rightContextSamples: right)
}
func shortFileCheck() throws {
    let waveform = [Float](repeating: 0, count: 24 * 16000)
    var original = SortformerFeatureLoader(config: config, audio: waveform)
    // Characterize the pinned upstream bug without loading/downloading models.
    try check(original.numChunks == 0 && original.next() == nil, "unpadded upstream regression changed")
    let completion = try plan(waveform.count)
    var fixed = SortformerFeatureLoader(config: config, audio: try completion.padded(waveform))
    try check(fixed.numChunks == 1 && fixed.next() != nil && fixed.next() == nil, "short file must reach inference")
}
func coverageCheck() throws {
    for count in [1, 8000, 24 * 16000, core - 1, core, core + right - 1,
                  core + right, core + right + 1, 32 * 16000, 60 * 16000] {
        let completion = try plan(count)
        try check(completion.paddedSamples >= count, "incomplete coverage")
        try check(completion.paddingSamples < core + right, "unbounded padding")
        try check((completion.paddedSamples - right) % core == 0, "partial final window")
        let waveform = [Float](repeating: 0.1, count: count)
        let padded = try completion.padded(waveform)
        try check(Array(padded.prefix(count)) == waveform, "original audio changed")
        try check(padded.dropFirst(count).allSatisfy { $0 == 0 }, "non-silent completion")
    }
}
func trailingWindowCheck() throws {
    let completion = try plan(32 * 16000)
    var loader = SortformerFeatureLoader(config: config, audio: try completion.padded([Float](repeating: 0, count: 32 * 16000)))
    try check(loader.numChunks == 2, "missing final model window")
    try check(loader.next() != nil && loader.next() != nil && loader.next() == nil, "wrong final-window iteration")
}
func invalidInputCheck() throws {
    let empty = try plan(0).padded([])
    try check(empty.isEmpty, "empty audio padded")
    try rejects({ _ = try plan(-1) }, "negative sample count accepted")
    try rejects({ _ = try SortformerCompletion(sampleCount: 1, sampleRate: 16000, coreSamples: 0, rightContextSamples: 1) }, "zero core accepted")
    try rejects({ _ = try SortformerCompletion(sampleCount: Int.max, sampleRate: 16000, coreSamples: 2, rightContextSamples: 0) }, "overflow accepted")
    try rejects({ _ = try plan(1).padded([]) }, "different input accepted")
}
func clippingCheck() throws {
    let completion = try plan(24 * 16000)
    try check(completion.clippedMilliseconds(start: -1, end: 2)?.start == 0, "negative output time")
    try check(completion.clippedMilliseconds(start: 23, end: 30)?.end == 24000, "padding time leaked")
    try check(completion.clippedMilliseconds(start: 2.125, end: 3.875)?.start == 2125, "valid timing changed")
    for (start, end) in [(24.0, 30.0), (4, 3), (.nan, 3), (1, .infinity), (1, 1.0001)] {
        try check(completion.clippedMilliseconds(start: start, end: end) == nil, "invalid segment retained")
    }
}
do {
    for (name, run) in [("short file", shortFileCheck), ("coverage matrix", coverageCheck),
                        ("trailing window", trailingWindowCheck), ("invalid input", invalidInputCheck), ("output clipping", clippingCheck)] {
        try run()
        print("PASS: \(name)")
    }
    print("5 completion checks passed; no model or audio downloads.")
} catch {
    FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8))
    exit(1)
}
