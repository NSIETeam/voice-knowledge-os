import AVFoundation
import Foundation
import Speech

private struct Reply: Encodable {
    let ok: Bool
    let available: Bool
    let supported: Bool
    let installed: Bool
    let locale: String
    var text: String? = nil
    var words: [TimedWord]? = nil
    var error: String? = nil
}

private struct TimedWord: Encodable {
    let text: String
    let startMs: Int64
    let endMs: Int64
}

private enum Failure: Error, LocalizedError {
    case usage
    var errorDescription: String? {
        "Usage: macos-speech status|prepare <language> | transcribe <language> <audio-file>"
    }
}

private func emit(_ value: Reply, code: Int32 = 0) -> Never {
    do {
        var data = try JSONEncoder().encode(value)
        data.append(0x0a)
        FileHandle.standardOutput.write(data)
    } catch {
        fputs("speech helper failed to encode response\n", stderr)
        exit(2)
    }
    exit(code)
}

private func localeFor(_ language: String) -> Locale {
    switch language.lowercased() {
    case "zh", "zh-cn", "zh-hans": Locale(identifier: "zh-CN")
    case "zh-tw", "zh-hant": Locale(identifier: "zh-TW")
    case "en": Locale(identifier: "en-US")
    case "no", "nb", "nn": Locale(identifier: "nb-NO")
    default: Locale(identifier: language)
    }
}

@available(macOS 26.0, *)
private func run(_ args: [String]) async throws -> Reply {
    guard args.count >= 2 else { throw Failure.usage }
    let requested = localeFor(args[1])
    let available = SpeechTranscriber.isAvailable
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        return Reply(ok: false, available: available, supported: false,
                     installed: false, locale: requested.identifier,
                     error: "Apple Speech does not support locale \(requested.identifier) on this Mac.")
    }
    let installed = await SpeechTranscriber.installedLocales.contains {
        $0.identifier == locale.identifier
    }
    switch args[0] {
    case "status":
        return Reply(ok: available, available: available, supported: true,
                     installed: installed, locale: locale.identifier,
                     error: available ? nil : "Apple Speech is unavailable on this Mac.")
    case "prepare":
        guard available else {
            return Reply(ok: false, available: false, supported: true,
                         installed: installed, locale: locale.identifier,
                         error: "Apple Speech is unavailable on this Mac.")
        }
        guard !installed else {
            return Reply(ok: true, available: true, supported: true,
                         installed: true, locale: locale.identifier)
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedTranscriptionWithAlternatives)
        _ = try await AssetInventory.reserve(locale: locale)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        let ready = await SpeechTranscriber.installedLocales.contains {
            $0.identifier == locale.identifier
        }
        return Reply(ok: ready, available: true, supported: true,
                     installed: ready, locale: locale.identifier,
                     error: ready ? nil : "Apple Speech language assets did not become available.")
    case "transcribe":
        guard args.count == 3 else { throw Failure.usage }
        guard available && installed else {
            return Reply(ok: false, available: available, supported: true,
                         installed: installed, locale: locale.identifier,
                         error: "Prepare the Apple Speech language in Settings before recording.")
        }
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[2]))
        let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedTranscriptionWithAlternatives)
        let analyzer = try await SpeechAnalyzer(inputAudioFile: file, modules: [transcriber], finishAfterFile: true)
        _ = analyzer
        var passages: [String] = []
        var words: [TimedWord] = []
        for try await result in transcriber.results {
            let attributedText = result.text
            let text = String(attributedText.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { passages.append(text) }
            for run in attributedText.runs {
                let segmentText = String(attributedText[run.range].characters)
                guard !segmentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      let range = run.audioTimeRange else { continue }
                let start = range.start.seconds
                let end = range.end.seconds
                guard start.isFinite, end.isFinite, start >= 0, end >= start else { continue }
                words.append(TimedWord(
                    text: segmentText,
                    startMs: Int64((start * 1_000).rounded()),
                    endMs: Int64((end * 1_000).rounded())
                ))
            }
        }
        let separator = args[1].lowercased().hasPrefix("zh") ? "" : " "
        return Reply(ok: true, available: true, supported: true,
                     installed: true, locale: locale.identifier,
                     text: passages.joined(separator: separator), words: words)
    default:
        throw Failure.usage
    }
}

@main
private struct SpeechCommand {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        guard #available(macOS 26.0, *) else {
            emit(Reply(ok: false, available: false, supported: false,
                       installed: false, locale: args.count > 1 ? args[1] : "",
                       error: "Apple SpeechTranscriber requires macOS 26 or later."), code: 1)
        }
        do {
            emit(try await run(args))
        } catch {
            emit(Reply(ok: false, available: false, supported: false,
                       installed: false,
                       locale: args.count > 1 ? localeFor(args[1]).identifier : "",
                       error: error.localizedDescription), code: 1)
        }
    }
}
