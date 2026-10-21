import Foundation
import FluidAudio
import DiarizationSupport

// Sidecar entrypoints. All commands write a single JSON payload to stdout
// (with download additionally streaming progress lines as JSON before the
// final payload). Exit 0 on success, 1 on failure with stderr message.
//
//   speaker-diarize <wav-path> [--num-speakers N] [--engine community1|sortformer|nemotron3]
//                                [--min-segment-duration S]
//                                [--segmentation-min-duration-on S]
//                                [--segmentation-step-ratio R]
//                                — run offline diarization on a WAV file.
//                                  Optional `--num-speakers N` pins the
//                                  cluster count when the caller knows it
//                                  (e.g. "I'm in a 1:1 with one other
//                                  person → N=2"). Without the flag, VBx
//                                  decides cluster count on its own —
//                                  which under-counts on conversations
//                                  dominated by one speaker. (community1
//                                  only — Sortformer has a fixed 4-speaker
//                                  cap and ignores the hint.)
//   speaker-diarize status   [--engine community1|sortformer|nemotron3]
//                                — model presence + size on disk
//   speaker-diarize download [--engine community1|sortformer|nemotron3]
//                                — download + compile (streams progress)
//   speaker-diarize delete   [--engine community1|sortformer|nemotron3]
//                                — wipe the cached model directory
//
// Default engine is `community1` (FluidAudio's `OfflineDiarizerManager` —
// community-1 segmentation + VBx clustering with PLDA score normalisation).
// The `sortformer` engine swaps in NVIDIA's Streaming Sortformer (4-speaker
// end-to-end transformer) running in batch mode via `SortformerDiarizer.
// processComplete(audioFileURL:)`. Sortformer trades the clustering
// approach's cleanliness for materially better behaviour on rapid
// speaker changes within a channel — the failure mode community-1 hits
// its architectural ceiling on. We use the `highContextV2_1` variant
// which expands chunkRightContext from 7 to 40 frames (~4s of right-side
// lookahead) for the offline accuracy we want here, not the streaming
// latency the default `fastV2_1` is tuned for.

let args = CommandLine.arguments

func writeStderr(_ msg: String) {
    FileHandle.standardError.write(Data("\(msg)\n".utf8))
}

func writeStdout(_ obj: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let s = String(data: data, encoding: .utf8) {
        print(s)
        fflush(stdout)
    }
}

guard args.count >= 2 else {
    writeStderr(
        "usage: speaker-diarize (<wav-path>|status|download|delete) [--engine community1|sortformer]"
    )
    exit(2)
}

enum Engine: String {
    case community1
    case sortformer
    case nemotron3
}

func parseEngine(_ args: [String]) -> Engine {
    if let i = args.firstIndex(of: "--engine"), i + 1 < args.count {
        return Engine(rawValue: args[i + 1]) ?? .community1
    }
    return .community1
}

func parseFloatFlag(_ args: [String], _ flag: String) -> Float? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return Float(args[i + 1])
}

func parseDoubleFlag(_ args: [String], _ flag: String) -> Double? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return Double(args[i + 1])
}

func parseIntFlag(_ args: [String], _ flag: String) -> Int? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return Int(args[i + 1])
}

/// Bridge a short hole only when the immediately preceding output segment is
/// from the same speaker. A segment from another speaker in the gap therefore
/// always prevents expansion across that turn boundary.
func bridgeSameSpeakerGaps(_ segments: [[String: Any]], maximumGapMs: Int) -> [[String: Any]] {
    let ordered = segments.sorted {
        let left = $0["start_ms"] as? Int ?? 0
        let right = $1["start_ms"] as? Int ?? 0
        if left == right { return ($0["end_ms"] as? Int ?? 0) < ($1["end_ms"] as? Int ?? 0) }
        return left < right
    }
    guard maximumGapMs > 0 else { return ordered }

    var output: [[String: Any]] = []
    for segment in ordered {
        guard let previous = output.last,
              let previousSpeaker = previous["speaker_id"] as? String,
              let speaker = segment["speaker_id"] as? String,
              previousSpeaker == speaker,
              let previousEnd = previous["end_ms"] as? Int,
              let start = segment["start_ms"] as? Int,
              start >= previousEnd,
              start - previousEnd <= maximumGapMs,
              let end = segment["end_ms"] as? Int
        else {
            output.append(segment)
            continue
        }
        output[output.count - 1]["end_ms"] = max(previousEnd, end)
    }
    return output
}

let engine = parseEngine(args)

// Only an explicit download command may contact a registry. FluidAudio's
// loader can otherwise repair/redownload a corrupt cache during inference.
ModelHub.offlineMode = args[1] != "download"

// Optional isolated cache root for diagnostics/acceptance. Defaults remain
// compatible with existing FluidAudio installations; never repurpose HOME.
let modelsRoot: URL = {
    if let i = args.firstIndex(of: "--models-dir") {
        guard i + 1 < args.count, args[i + 1].hasPrefix("/") else {
            writeStderr("--models-dir requires an absolute directory path")
            exit(2)
        }
        return URL(fileURLWithPath: args[i + 1], isDirectory: true)
    }
    return OfflineDiarizerModels.defaultModelsDirectory()
}()

func artifactPresent(_ url: URL) -> Bool {
    if url.pathExtension == "mlmodelc" {
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), directory.boolValue else { return false }
        let metadata = url.appendingPathComponent("coremldata.bin")
        return ((try? metadata.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 0
    }
    guard let data = try? Data(contentsOf: url), !data.isEmpty else { return false }
    if url.lastPathComponent == "plda-parameters.json" {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tensors = json["tensors"] as? [String: Any],
              let psi = tensors["psi"] as? [String: Any],
              let encoded = psi["data_base64"] as? String,
              let decoded = Data(base64Encoded: encoded),
              !decoded.isEmpty, decoded.count % MemoryLayout<Float>.size == 0 else { return false }
    }
    return true
}

// CoreML models are .mlmodelc directories — `.size` on a directory only
// reports the directory entry, not its contents. Walk recursively.
func directorySize(_ url: URL) -> Int64 {
    let enumerator = FileManager.default.enumerator(
        at: url,
        includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
        options: [.skipsHiddenFiles]
    )
    var total: Int64 = 0
    while let item = enumerator?.nextObject() as? URL {
        if let v = try? item.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
           v.isRegularFile == true,
           let size = v.fileSize {
            total += Int64(size)
        }
    }
    return total
}

// FluidAudio stores the offline diarizer files under
// <FluidAudio/Models>/speaker-diarization/ — the parent dir comes from
// `OfflineDiarizerModels.defaultModelsDirectory()`, the subdir name from
// `Repo.diarizer.folderName`. We resolve the leaf path here so status/delete
// inspect exactly what `OfflineDiarizerModels.load` writes.
func community1ModelsDirectory() -> URL {
    modelsRoot
        .appendingPathComponent(Repo.diarizer.folderName, isDirectory: true)
}

// Sortformer models live under
// <Library/Application Support/FluidAudio/Models>/sortformer/<variant>.mlmodelc
// per FluidAudio's DownloadUtils — note the subdir is `sortformer`, not the
// HF repo's path component (`diar-streaming-sortformer-coreml`). We use the
// highContextV2_1 variant for offline accuracy.
let sortformerVariant: ModelNames.Sortformer.Variant = .highContextV2_1
let sortformerConfig: SortformerConfig = .highContextV2_1
let nemotron3Config = Nemotron3Config.fast128

func sortformerModelsDirectory() -> URL {
    modelsRoot
        .appendingPathComponent("sortformer", isDirectory: true)
}

func sortformerModelPath() -> URL {
    sortformerModelsDirectory()
        .appendingPathComponent(sortformerVariant.fileName, isDirectory: true)
}

// Nemotron 3 fast128 is the offline-quality profile selected by the ADR.
// FluidAudio 0.17.4 stores monolithic presets under `monolithic/v2` on M3+
// and keeps the checkpoint marker + shared silence embedding at the repo root.
func nemotron3ModelsDirectory() -> URL {
    modelsRoot.appendingPathComponent(Repo.nemotron3Diarization.folderName, isDirectory: true)
}

func nemotron3ModelPath() -> URL {
    nemotron3ModelsDirectory()
        .appendingPathComponent(nemotron3Config.hubSubdirectory, isDirectory: true)
        .appendingPathComponent(nemotron3Config.modelFileName, isDirectory: true)
}

func nemotron3ModelsReady() -> Bool {
    let root = nemotron3ModelsDirectory()
    guard
        let marker = try? String(
            contentsOf: root.appendingPathComponent(ModelNames.Nemotron3.weightsVersionFile),
            encoding: .utf8
        ).trimmingCharacters(in: .whitespacesAndNewlines),
        marker == ModelNames.Nemotron3.weightsVersion,
        artifactPresent(nemotron3ModelPath())
    else { return false }
    return artifactPresent(
        root.appendingPathComponent(ModelNames.Nemotron3.silenceEmbeddingFile))
}

// MARK: - Status

func runStatusCommunity1() {
    let dir = community1ModelsDirectory()
    let exists = FileManager.default.fileExists(atPath: dir.path)
    if !exists {
        writeStdout([
            "downloaded": false,
            "path": NSNull(),
            "sizeBytes": NSNull(),
        ] as [String: Any])
        return
    }
    let required = ModelNames.OfflineDiarizer.requiredModels
    var allPresent = true
    for name in required {
        let modelURL = dir.appendingPathComponent(name)
        if !artifactPresent(modelURL) {
            allPresent = false
            break
        }
    }
    let size = directorySize(dir)
    writeStdout([
        "downloaded": allPresent,
        "path": dir.path,
        "sizeBytes": size,
    ] as [String: Any])
}

func runStatusSortformer() {
    let modelPath = sortformerModelPath()
    let exists = artifactPresent(modelPath)
    if !exists {
        writeStdout([
            "downloaded": false,
            "path": NSNull(),
            "sizeBytes": NSNull(),
        ] as [String: Any])
        return
    }
    let size = directorySize(modelPath)
    writeStdout([
        "downloaded": true,
        "path": modelPath.path,
        "sizeBytes": size,
    ] as [String: Any])
}

func runStatusNemotron3() {
    let root = nemotron3ModelsDirectory()
    let size: Any = FileManager.default.fileExists(atPath: root.path)
        ? directorySize(root) as Any : NSNull()
    writeStdout([
        "downloaded": nemotron3ModelsReady(),
        "path": root.path,
        "sizeBytes": size,
    ] as [String: Any])
}

// MARK: - Delete

func runDelete() -> Int32 {
    let dir: URL
    switch engine {
    case .community1: dir = community1ModelsDirectory()
    case .sortformer: dir = sortformerModelsDirectory()
    case .nemotron3: dir = nemotron3ModelsDirectory()
    }
    do {
        if FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.removeItem(at: dir)
        }
        writeStdout(["deleted": true, "path": dir.path])
        return 0
    } catch {
        writeStderr("delete error: \(error.localizedDescription)")
        return 1
    }
}

// MARK: - Download

func runDownloadCommunity1() async -> Int32 {
    do {
        // `OfflineDiarizerModels.load` triggers downloadIfNeeded under the
        // hood and surfaces the same DownloadProgress phases as the streaming
        // path used to. Forward each tick to stdout so the Rust side can emit
        // Tauri events to the UI progress bar.
        _ = try await OfflineDiarizerModels.load(from: modelsRoot, progressHandler: { progress in
            let phase: String
            switch progress.phase {
            case .listing: phase = "listing"
            case .downloading: phase = "downloading"
            case .compiling: phase = "compiling"
            }
            writeStdout([
                "event": "progress",
                "fraction": progress.fractionCompleted,
                "phase": phase,
            ] as [String: Any])
        })
        writeStdout(["event": "done"])
        return 0
    } catch {
        writeStderr("download error: \(error)")
        return 1
    }
}

func runDownloadSortformer() async -> Int32 {
    do {
        _ = try await SortformerModels.loadFromHuggingFace(
            config: sortformerConfig,
            cacheDirectory: modelsRoot,
            progressHandler: { progress in
                let phase: String
                switch progress.phase {
                case .listing: phase = "listing"
                case .downloading: phase = "downloading"
                case .compiling: phase = "compiling"
                }
                writeStdout([
                    "event": "progress",
                    "fraction": progress.fractionCompleted,
                    "phase": phase,
                ] as [String: Any])
            }
        )
        writeStdout(["event": "done"])
        return 0
    } catch {
        writeStderr("download error: \(error)")
        return 1
    }
}

func runDownloadNemotron3() async -> Int32 {
    do {
        _ = try await Nemotron3Models.loadFromHuggingFace(
            config: nemotron3Config,
            cacheDirectory: modelsRoot,
            progressHandler: { progress in
                let phase: String
                switch progress.phase {
                case .listing: phase = "listing"
                case .downloading: phase = "downloading"
                case .compiling: phase = "compiling"
                }
                writeStdout([
                    "event": "progress",
                    "fraction": progress.fractionCompleted,
                    "phase": phase,
                ] as [String: Any])
            }
        )
        guard nemotron3ModelsReady() else {
            writeStderr("humla-error: Nemotron 3 download did not produce a complete, current model cache")
            return 1
        }
        writeStdout(["event": "done"])
        return 0
    } catch {
        writeStderr("humla-error: Nemotron 3 download failed: \(error.localizedDescription)")
        return 1
    }
}

// MARK: - Diarize: community1

func runDiarizeCommunity1(
    audioPath: String,
    numSpeakers: Int?,
    threshold: Double?,
    minSegmentDuration: Double?,
    segmentationMinDurationOn: Double?,
    segmentationStepRatio: Double?
) async -> Int32 {
    do {
        // Tuning notes:
        //   - clusteringThreshold default 0.5 (community default is 0.6).
        //     FluidAudio 0.17.4 uses a Euclidean AHC cut distance: HIGHER
        //     values merge more aggressively and yield FEWER clusters.
        //     VBx refines that initialization, so final speaker counts are
        //     not guaranteed to vary monotonically. Override via --threshold.
        //   - excludeOverlap stays true (default): when two speakers overlap,
        //     the overlapping frames are masked out before extracting per-
        //     speaker embeddings, so the embedding stays clean.
        //   - exclusiveSegments stays true (default): output is non-overlapping
        //     so each chunk maps to exactly one speaker for the chunk-to-
        //     segment alignment in commands.rs::assign_speaker.
        //   - segmentation.minDurationOn lifted from the community-1 default
        //     0.0 → 1.0: the segmentation model otherwise emits sub-second
        //     "speaker B" blips for backchannels ("yeah", "right") inside a
        //     longer monologue, which break a single sentence across three
        //     `Speaker N:` lines after word-level alignment in
        //     commands.rs::split_by_segments. Pyannote's own paper recommends
        //     ≥1.0 here; the 1.4% DER cost noted in FluidAudio's source is a
        //     fair trade for fewer fragmented lines in the rendered
        //     transcript. commands.rs::bridge_short_interjections cleans up
        //     anything that still slips through.
        //   - segmentation.minDurationOff lifted 0.0 → 0.5: sub-half-second
        //     intra-speaker pauses no longer break a turn, which keeps a
        //     single thought on one line even when the speaker briefly
        //     breathes mid-sentence.
        var config = OfflineDiarizerConfig(
            clusteringThreshold: threshold ?? 0.5,
            segmentationStepRatio: segmentationStepRatio ?? 0.2,
            minSegmentDuration: minSegmentDuration ?? 1.0,
            segmentationMinDurationOn: segmentationMinDurationOn ?? 1.0,
            segmentationMinDurationOff: 0.5
        )
        // Caller-supplied speaker count hint when the user knows the count
        // ahead of time. `withSpeakers(exactly:)` overrides the auto cluster
        // detection inside VBx — without it, VBx is free to pick any
        // count, and on dominant-speaker conversations it tends to choose 1.
        if let n = numSpeakers, n > 0 {
            config = config.withSpeakers(exactly: n)
        }
        let manager = OfflineDiarizerManager(config: config)
        // The convenience prepareModels() purges a failed cache before its
        // retry, even in offline mode. Use the public explicit loader instead:
        // ModelHub's offline contract preserves files and forbids redownload.
        let models = try await OfflineDiarizerModels.load(from: modelsRoot)
        manager.initialize(models: models)

        let url = URL(fileURLWithPath: audioPath)
        let result: DiarizationResult
        do {
            result = try await manager.process(url)
        } catch OfflineDiarizationError.noSpeechDetected {
            // FluidAudio raises noSpeechDetected when its segmentation
            // model finds no speech frames in the audio (very short or
            // very quiet recordings, sometimes the brief moment between
            // VAD chunks closing and stop being signalled). This isn't
            // an error — surface as an empty segment array so the Rust
            // side's existing "no segments" graceful path handles it
            // (skip in mic-only / sys-only, single-speaker fallback in
            // hybrid). Avoids dumping a wall of FluidAudio profiling
            // logs into the user's recording-error toast.
            let data = try JSONSerialization.data(withJSONObject: [] as [Any])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return 0
        }

        // Output shape stays identical to the previous DiarizerManager path:
        // an array of {start_ms, end_ms, speaker_id} that the Rust side can
        // align to chunks via start_ms.
        let payload: [[String: Any]] = result.segments.map { seg in
            [
                "start_ms": Int(seg.startTimeSeconds * 1000.0),
                "end_ms": Int(seg.endTimeSeconds * 1000.0),
                "speaker_id": seg.speakerId,
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        return 0
    } catch {
        // Tag the actual error on its own dedicated line so the Rust
        // side can pluck it out of FluidAudio's profiling stderr noise
        // for the user toast. Profiling output goes to stderr in front
        // of this line; we only want THIS line to reach the UI.
        writeStderr("humla-error: \(error.localizedDescription)")
        return 1
    }
}

// MARK: - Diarize: Sortformer

func runDiarizeSortformer(
    audioPath: String,
    silenceThreshold: Float?,
    predScoreThreshold: Float?,
    maxSameSpeakerGapMs: Int?
) async -> Int32 {
    do {
        let modelPath = sortformerModelPath()
        guard FileManager.default.fileExists(atPath: modelPath.path) else {
            writeStderr("humla-error: Sortformer model not downloaded")
            return 1
        }

        // SortformerConfig is a struct of `var` thresholds, so we can clone
        // the highContextV2_1 default and override the two we expose.
        var config = sortformerConfig
        if let s = silenceThreshold { config.silenceThreshold = s }
        if let p = predScoreThreshold { config.predScoreThreshold = p }

        // Use loadFromHuggingFace rather than initialize(mainModelPath:):
        // the latter calls MLModel.compileModel(at:) which expects a raw
        // .mlpackage, but FluidAudio's downloader writes the already-
        // compiled .mlmodelc. loadFromHuggingFace handles both — when
        // the model is already cached it's a quick load, no re-download.
        let models = try await SortformerModels.loadFromHuggingFace(config: config, cacheDirectory: modelsRoot)

        let diarizer = SortformerDiarizer(config: config)
        diarizer.initialize(models: models)

        let url = URL(fileURLWithPath: audioPath)
        // The pinned batch loader otherwise skips all files below 30.4 s and
        // the incomplete final window of longer files. Supply completion
        // context to the same pretrained model, then clip to the original WAV.
        let samples = try AudioConverter(sampleRate: Double(config.sampleRate)).resampleAudioFile(url)
        let completion = try SortformerCompletion(
            sampleCount: samples.count, sampleRate: config.sampleRate,
            coreSamples: config.coreFrames * config.melStride,
            rightContextSamples: config.chunkRightContext * config.subsamplingFactor * config.melStride
        )
        if samples.isEmpty { writeStdout([] as [Any]); return 0 }
        let timeline = try diarizer.processComplete(try completion.padded(samples))
        let coveredSeconds = Double(diarizer.numFramesProcessed) * Double(config.frameDurationSeconds)
        guard coveredSeconds + Double(config.frameDurationSeconds) >= completion.durationSeconds else {
            writeStderr("humla-error: Sortformer did not process the complete recording")
            return 1
        }
        writeStderr("sortformer: inputSamples=\(samples.count) completionSamples=\(completion.paddingSamples) processedFrames=\(diarizer.numFramesProcessed)")

        // Flatten DiarizerTimeline → [{start_ms, end_ms, speaker_id}] in
        // the same shape the community-1 path emits. Each speaker holds its
        // own segments collection; merge them into a single time-sorted
        // array using a stable "S<slot>" speaker_id string. We pull from
        // both finalized and tentative buckets — processComplete with
        // finalizeOnCompletion=true (its default) confirms everything, but
        // tentative is kept in the union for robustness if that contract
        // ever changes upstream.
        //
        // Debug print of the raw slot map to stderr so the developer can
        // tell whether "only S0 in output" means "the model heard one
        // speaker" vs. "we dropped slots in the mapping". With Sortformer's
        // 4-speaker cap, the timeline carries 4 slots regardless of how
        // many actually fired — slots with zero segments are real signal
        // (the model was confident enough to leave them empty).
        writeStderr(
            "sortformer: timeline.speakers has \(timeline.speakers.count) slot(s)"
        )
        for (slot, speaker) in timeline.speakers.sorted(by: { $0.key < $1.key }) {
            writeStderr(
                "  slot=\(slot) finalized=\(speaker.finalizedSegments.count) tentative=\(speaker.tentativeSegments.count)"
            )
        }

        var payload: [[String: Any]] = []
        for (slot, speaker) in timeline.speakers {
            let id = "S\(slot)"
            let segs = speaker.finalizedSegments + speaker.tentativeSegments
            for seg in segs {
                guard let clipped = completion.clippedMilliseconds(start: Double(seg.startTime), end: Double(seg.endTime)) else { continue }
                payload.append([
                    "start_ms": clipped.start,
                    "end_ms": clipped.end,
                    "speaker_id": id,
                ])
            }
        }
        payload.sort { (a, b) in
            (a["start_ms"] as? Int ?? 0) < (b["start_ms"] as? Int ?? 0)
        }
        let maximumGap = maxSameSpeakerGapMs ?? 1000
        guard (0...5000).contains(maximumGap) else {
            writeStderr("humla-error: same-speaker bridge gap must be between 0 and 5000 ms")
            return 1
        }
        let smoothedPayload = bridgeSameSpeakerGaps(payload, maximumGapMs: maximumGap)
        writeStderr("sortformer: bridged same-speaker gaps up to \(maximumGap)ms; segments \(payload.count) → \(smoothedPayload.count)")
        let data = try JSONSerialization.data(withJSONObject: smoothedPayload)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        return 0
    } catch {
        writeStderr("humla-error: \(error.localizedDescription)")
        return 1
    }
}

// MARK: - Diarize: Nemotron 3

func runDiarizeNemotron3(audioPath: String, threshold: Float?) async -> Int32 {
    do {
        guard nemotron3ModelsReady() else {
            writeStderr("humla-error: Nemotron 3 fast128 model not downloaded or weights are stale")
            return 1
        }
        // Offline mode is set before dispatch. The preflight above plus
        // loadFromHuggingFace's matching weights marker guarantees its cache
        // path is read-only here; only the explicit download command may fetch.
        let models = try await Nemotron3Models.loadFromHuggingFace(
            config: nemotron3Config, cacheDirectory: modelsRoot)
        let diarizer = Nemotron3Diarizer(config: nemotron3Config, models: models)
        let url = URL(fileURLWithPath: audioPath)
        let samples = try AudioConverter(sampleRate: Double(nemotron3Config.sampleRate))
            .resampleAudioFile(url)
        guard !samples.isEmpty else {
            writeStdout([] as [Any])
            return 0
        }
        let result = try diarizer.processComplete(samples)
        let segments = Nemotron3Diarizer.segments(
            probabilities: result.probabilities,
            frameCount: result.frameCount,
            threshold: threshold ?? 0.5
        )
        let payload: [[String: Any]] = segments.map { segment in
            [
                "start_ms": Int(segment.startSeconds * 1000),
                "end_ms": Int(segment.endSeconds * 1000),
                "speaker_id": "S\(segment.speakerIndex)",
            ]
        }
        writeStderr(
            "nemotron3: processed \(samples.count) samples; frames=\(result.frameCount); segments=\(payload.count); speakers=\(Set(segments.map(\.speakerIndex)).count)"
        )
        writeStdout(payload)
        return 0
    } catch {
        writeStderr("humla-error: Nemotron 3 inference failed: \(error.localizedDescription)")
        return 1
    }
}

let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 0

switch args[1] {
case "status":
    switch engine {
    case .community1: runStatusCommunity1()
    case .sortformer: runStatusSortformer()
    case .nemotron3: runStatusNemotron3()
    }
case "delete":
    exitCode = runDelete()
case "download":
    Task {
        switch engine {
        case .community1: exitCode = await runDownloadCommunity1()
        case .sortformer: exitCode = await runDownloadSortformer()
        case .nemotron3: exitCode = await runDownloadNemotron3()
        }
        semaphore.signal()
    }
    semaphore.wait()
default:
    // Positional <wav-path>, optional `--num-speakers N` and `--engine` flags.
    let path = args[1]
    var numSpeakers: Int? = nil
    if let i = args.firstIndex(of: "--num-speakers"),
       i + 1 < args.count,
       let n = Int(args[i + 1]),
       n > 0 {
        numSpeakers = n
    }
    let clusteringThreshold = parseDoubleFlag(args, "--threshold")
    let minSegmentDuration = parseDoubleFlag(args, "--min-segment-duration")
    let segmentationMinDurationOn = parseDoubleFlag(args, "--segmentation-min-duration-on")
    let segmentationStepRatio = parseDoubleFlag(args, "--segmentation-step-ratio")
    let silenceThreshold = parseFloatFlag(args, "--silence-threshold")
    let predScoreThreshold = parseFloatFlag(args, "--pred-threshold")
    let maxSameSpeakerGapMs = parseIntFlag(args, "--max-same-speaker-gap-ms")
    Task {
        switch engine {
        case .community1:
            exitCode = await runDiarizeCommunity1(
                audioPath: path,
                numSpeakers: numSpeakers,
                threshold: clusteringThreshold,
                minSegmentDuration: minSegmentDuration,
                segmentationMinDurationOn: segmentationMinDurationOn,
                segmentationStepRatio: segmentationStepRatio
            )
        case .sortformer:
            exitCode = await runDiarizeSortformer(
                audioPath: path,
                silenceThreshold: silenceThreshold,
                predScoreThreshold: predScoreThreshold,
                maxSameSpeakerGapMs: maxSameSpeakerGapMs
            )
        case .nemotron3:
            exitCode = await runDiarizeNemotron3(
                audioPath: path,
                threshold: predScoreThreshold
            )
        }
        semaphore.signal()
    }
    semaphore.wait()
}

exit(exitCode)
