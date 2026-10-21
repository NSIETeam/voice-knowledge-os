import Foundation

/// FluidAudio 0.17.1's batch feature loader requires a full core + right
/// context even on the last iteration. Without completion padding it skips
/// short recordings entirely and drops the remainder of longer recordings.
/// Pad only inference input; never mutate the source audio or emit padded time.
public struct SortformerCompletion {
    public enum Failure: Error { case invalidConfiguration, durationOverflow }
    public let originalSamples: Int
    public let paddedSamples: Int
    public let sampleRate: Int
    public var paddingSamples: Int { paddedSamples - originalSamples }
    public var durationSeconds: Double { Double(originalSamples) / Double(sampleRate) }

    public init(sampleCount: Int, sampleRate: Int, coreSamples: Int, rightContextSamples: Int) throws {
        guard sampleCount >= 0, sampleRate > 0, coreSamples > 0, rightContextSamples >= 0 else {
            throw Failure.invalidConfiguration
        }
        self.originalSamples = sampleCount
        self.sampleRate = sampleRate
        if sampleCount == 0 { paddedSamples = 0; return }
        // The last window's right-context predictions are finalized by
        // processComplete, so they count toward coverage of the real audio.
        let coreNeeded = max(0, sampleCount - rightContextSamples)
        let chunks = max(1, coreNeeded / coreSamples + (coreNeeded % coreSamples == 0 ? 0 : 1))
        let (core, multiplyOverflow) = chunks.multipliedReportingOverflow(by: coreSamples)
        let (total, addOverflow) = core.addingReportingOverflow(rightContextSamples)
        guard !multiplyOverflow, !addOverflow else { throw Failure.durationOverflow }
        paddedSamples = total
    }

    public func padded(_ samples: [Float]) throws -> [Float] {
        guard samples.count == originalSamples else { throw Failure.invalidConfiguration }
        return samples + [Float](repeating: 0, count: paddingSamples)
    }

    /// Clip model output to the real recording, dropping segments wholly in
    /// the completion context. Keep the original speaker identity unchanged.
    public func clippedMilliseconds(start: Double, end: Double) -> (start: Int, end: Int)? {
        guard start.isFinite, end.isFinite, end > start else { return nil }
        let first = max(0, start)
        let last = min(durationSeconds, end)
        guard last > first else { return nil }
        let firstMs = Int((first * 1000).rounded(.down))
        let lastMs = Int((last * 1000).rounded(.down))
        return lastMs > firstMs ? (firstMs, lastMs) : nil
    }
}
