#!/usr/bin/env python3
"""Opt-in macOS smoke: synthetic or licensed public voices, never user recordings.
Requires the selected engine's model to have been explicitly downloaded beforehand.
"""
import argparse
from array import array
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import wave


def invoke(sidecar, *args, env=None, expected_success=True, timeout=90):
    result = subprocess.run([str(sidecar), *map(str, args)], capture_output=True, text=True,
                            env=env, timeout=timeout)
    if expected_success and result.returncode:
        raise AssertionError(f"helper failed ({result.returncode}): {result.stderr[-2000:]}")
    return result


def payload(result):
    for line in reversed(result.stdout.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise AssertionError("helper did not return JSON")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", type=Path, default=Path(__file__).resolve().parents[1] /
                        "src-tauri/binaries/speaker-diarize-aarch64-apple-darwin")
    parser.add_argument("--diagnose-thresholds", action="store_true",
                        help="Also report AHC thresholds without changing the default acceptance gate.")
    parser.add_argument("--min-segment-duration", type=float,
                        help="Community-1 diagnostic override; default remains 1.0 s.")
    parser.add_argument("--segmentation-min-duration-on", type=float,
                        help="Community-1 diagnostic override; default remains 1.0 s.")
    parser.add_argument("--segmentation-step-ratio", type=float,
                        help="Community-1 diagnostic override; default remains 0.2.")
    parser.add_argument("--diagnostic-logs", action="store_true", help="Include helper diagnostics for test audio only.")
    parser.add_argument("--fixture", choices=("mandarin", "english-control", "aishell3", "aishell3-long"), default="mandarin",
                        help="The English diagnostic control does not replace Mandarin acceptance.")
    parser.add_argument("--download-fixtures", action="store_true", help="Explicitly allow the pinned AISHELL-3 fixture download (under 1.9 MB per fixture).")
    parser.add_argument("--fixture-source", choices=("mirror", "official"), default="mirror")
    parser.add_argument("--engine", choices=("community1", "sortformer", "nemotron3"), default="community1")
    parser.add_argument("--download-model", action="store_true",
                        help="Explicitly download the selected engine via the Hugging Face mirror. Uses and retains --models-dir when supplied; otherwise uses a temporary cache that is removed on exit.")
    parser.add_argument("--models-dir", type=Path,
                        help="Use an explicitly isolated model cache directory; useful for running multiple fixtures against one download.")
    parser.add_argument("--sortformer-profile", choices=("app", "sdk"), default="app",
                        help="Use app thresholds (0.5 / 0.25); sdk keeps the old diagnostic defaults for A/B comparison.")
    parser.add_argument("--sortformer-silence-threshold", type=float,
                        help="Diagnostic override; app default is 0.5.")
    parser.add_argument("--sortformer-pred-threshold", type=float,
                        help="Diagnostic override; app default is 0.25.")
    parser.add_argument("--nemotron-pred-threshold", type=float,
                        help="Diagnostic-only Nemotron speaker probability threshold; model default is 0.5.")
    parser.add_argument("--max-same-speaker-gap-ms", type=int,
                        help="Diagnostic override for Sortformer gap bridging; app default is 1000 ms.")
    args = parser.parse_args()
    if args.models_dir and not args.models_dir.is_absolute():
        parser.error("--models-dir must be an absolute path")
    if args.fixture.startswith("aishell3") and not args.download_fixtures:
        parser.error("AISHELL-3 requires --download-fixtures; no implicit network access.")
    sidecar = args.sidecar.resolve(strict=True)
    report = {"fixture": args.fixture, "engine": args.engine, "helperSha256": hashlib.sha256(sidecar.read_bytes()).hexdigest()}
    sortformer_args = []
    nemotron_args = []
    community_args = []
    for flag, value in (
        ("--min-segment-duration", args.min_segment_duration),
        ("--segmentation-min-duration-on", args.segmentation_min_duration_on),
        ("--segmentation-step-ratio", args.segmentation_step_ratio),
    ):
        if value is not None:
            if value < 0 or value > 5:
                parser.error(f"{flag} must be between 0 and 5")
            community_args.extend((flag, str(value)))
    if args.engine == "sortformer":
        report["settingsProfile"] = args.sortformer_profile
        silence_threshold = args.sortformer_silence_threshold
        pred_threshold = args.sortformer_pred_threshold
        if args.sortformer_profile == "app":
            silence_threshold = 0.5 if silence_threshold is None else silence_threshold
            pred_threshold = 0.25 if pred_threshold is None else pred_threshold
        for flag, value in (("--sortformer-silence-threshold", silence_threshold),
                            ("--sortformer-pred-threshold", pred_threshold)):
            if value is not None and (value < 0 or value > 1):
                parser.error(f"{flag} must be between 0 and 1")
        if silence_threshold is not None:
            sortformer_args.extend(("--silence-threshold", str(silence_threshold)))
        if pred_threshold is not None:
            sortformer_args.extend(("--pred-threshold", str(pred_threshold)))
        if args.max_same_speaker_gap_ms is not None:
            if args.max_same_speaker_gap_ms < 0 or args.max_same_speaker_gap_ms > 5000:
                parser.error("--max-same-speaker-gap-ms must be between 0 and 5000")
            sortformer_args.extend(("--max-same-speaker-gap-ms", str(args.max_same_speaker_gap_ms)))
        report["sortformerThresholds"] = {
            "silence": silence_threshold,
            "prediction": pred_threshold,
            "maxSameSpeakerGapMs": args.max_same_speaker_gap_ms if args.max_same_speaker_gap_ms is not None else 1000,
        }
    if args.engine == "nemotron3":
        if args.nemotron_pred_threshold is not None:
            if not 0 <= args.nemotron_pred_threshold <= 1:
                parser.error("--nemotron-pred-threshold must be between 0 and 1")
            nemotron_args.extend(("--pred-threshold", str(args.nemotron_pred_threshold)))
        report["nemotronThresholds"] = {
            "prediction": args.nemotron_pred_threshold if args.nemotron_pred_threshold is not None else 0.5,
        }
    env = dict(os.environ)
    for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACEHUB_API_TOKEN"):
        env.pop(key, None)

    with tempfile.TemporaryDirectory(prefix="honeyvoice-diarize-qa-") as temporary:
        root = Path(temporary)
        model_cache = args.models_dir or (root / "model-cache" if args.download_model else None)
        model_args = ["--models-dir", model_cache] if model_cache else []
        if args.download_model:
            download_env = dict(env)
            download_env["REGISTRY_URL"] = "https://hf-mirror.com"
            print(f"Explicitly downloading {args.engine} into a temporary cache from the Hugging Face mirror.", flush=True)
            invoke(sidecar, "download", "--engine", args.engine, *model_args,
                   env=download_env, timeout=900)
        status = payload(invoke(sidecar, "status", "--engine", args.engine, *model_args))
        assert status["downloaded"], f"Download {args.engine} explicitly or pass --download-model."
        report["modelBytes"] = status["sizeBytes"]
        # Two different installed Mandarin voices, alternating twice. This is
        # a bounded pipeline acceptance fixture, not a diarization benchmark.
        turns = [
            ("Tingting", "今天我们检查本地会议录音。先确认每一位说话人的内容能够分别保存。"),
            ("Meijia", "我负责测试语音处理。稍后会检查声音切换的位置，还有离线处理的结果。"),
            ("Tingting", "好的，我再补充一点。这个测试只使用合成语音，不包含任何真实会议内容。"),
            ("Meijia", "收到，测试结束以后，我们还要核对时间顺序，确保没有遗漏任何一段发言。"),
        ]
        if args.fixture == "english-control":
            turns = [
                ("Daniel", "Today we are checking the local meeting recorder. Each person should have a separate speaker label in the final transcript."),
                ("Samantha", "I will test the audio processing. We need to check the speaker changes and make sure that all processing stays offline."),
                ("Daniel", "I would also like to clarify that these are artificial voices. This recording contains no real meeting or private conversation."),
                ("Samantha", "After the test, we should check the order of the statements. Nothing should disappear when the speaker changes."),
            ]
        report["voices"] = [voice for voice, _ in turns]
        if args.fixture.startswith("aishell3"):
            from diarize_fixtures import prepare_aishell3
            turns, report["publicFixture"] = prepare_aishell3(root, args.fixture_source, args.fixture)
            report["voices"] = [voice for voice, _ in turns]
        combined = bytearray(b"\0" * 16000)
        bounds = []
        report["turns"] = []
        for index, (voice, text) in enumerate(turns):
            if isinstance(text, bytes):
                frames = text
            else:
                aiff, wav = root / f"turn-{index}.aiff", root / f"turn-{index}.wav"
                subprocess.run(["/usr/bin/say", "-v", voice, "-r", "165", "-o", str(aiff), text], check=True, timeout=30)
                subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)], check=True, timeout=30)
                with wave.open(str(wav), "rb") as audio:
                    assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
                    frames = audio.readframes(audio.getnframes())
            start = len(combined) / 32
            if len(frames) % 2:
                raise RuntimeError(
                    f"TTS voice {voice!r} produced malformed 16-bit PCM for turn {index + 1}."
                )
            samples = array("h", frames)
            if sys.byteorder != "little":
                samples.byteswap()
            if not samples:
                raise RuntimeError(
                    f"TTS voice {voice!r} produced an empty audio file for turn {index + 1}; "
                    "check that the macOS voice assets are installed and available, then rerun."
                )
            report["turns"].append({"speaker": voice, "durationMs": len(frames) / 32,
                                    "rms": round((sum(s * s for s in samples) / len(samples)) ** .5 / 32768, 6),
                                    "peak": round(max(abs(s) for s in samples) / 32768, 6)})
            combined.extend(frames)
            bounds.append((start, len(combined) / 32))
            combined.extend(b"\0" * 19200)  # 600 ms between turns
        fixture = root / "two-voices.wav"
        with wave.open(str(fixture), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(combined)
        silent = root / "silence.wav"
        with wave.open(str(silent), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(b"\0" * 160000)
        report["fixtureDurationMs"] = len(combined) / 32
        print(f"Prepared {args.fixture} fixture; testing local inference.", flush=True)

        # An in-process HTTP trap is stronger than merely pointing at a dead
        # URL: any unexpected registry request makes this test fail.
        requests = []
        class RegistryTrapServer(http.server.ThreadingHTTPServer):
            def get_request(self):
                request = super().get_request()
                requests.append("connection")
                return request
        class Trap(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(500)
                self.end_headers()
            do_HEAD = do_GET
            do_POST = do_GET
            def log_message(self, *_):
                pass
        server = RegistryTrapServer(("127.0.0.1", 0), Trap)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env["REGISTRY_URL"] = f"http://127.0.0.1:{server.server_port}"
        try:
            missing = root / "empty-cache"
            result = invoke(sidecar, fixture, "--engine", args.engine, "--models-dir", missing,
                            env=env, expected_success=False, timeout=15)
            assert result.returncode != 0, "Missing model must fail without downloading."
            if args.engine == "community1":
                corrupt = root / "corrupt-cache" / "speaker-diarization"
                for name in ("Segmentation", "Embedding", "FBank", "PldaRho"):
                    (corrupt / f"{name}.mlmodelc").mkdir(parents=True)
                (corrupt / "plda-parameters.json").write_text("{}")
                assert not payload(invoke(sidecar, "status", "--engine", args.engine,
                                           "--models-dir", corrupt.parent))["downloaded"]
                result = invoke(sidecar, fixture, "--engine", args.engine, "--models-dir", corrupt.parent,
                                env=env, expected_success=False, timeout=15)
                assert result.returncode != 0
                assert (corrupt / "plda-parameters.json").read_text() == "{}", "Offline failure must preserve cache."
            elif args.engine == "nemotron3":
                corrupt_root = root / "corrupt-cache"
                corrupt_model = corrupt_root / "nemotron-3-diarization"
                corrupt_model.mkdir(parents=True)
                (corrupt_model / ".fluidaudio-nemotron3-weights").write_text("stale-weights")
                assert not payload(invoke(sidecar, "status", "--engine", args.engine,
                                          "--models-dir", corrupt_root))["downloaded"]
                result = invoke(sidecar, fixture, "--engine", args.engine, "--models-dir", corrupt_root,
                                env=env, expected_success=False, timeout=15)
                assert result.returncode != 0 and (corrupt_model / ".fluidaudio-nemotron3-weights").read_text() == "stale-weights"
            # Deletion checks use only this script's temporary cache, never
            # the real installed models. Failure must not be reported as success.
            locked = root / "locked-cache"
            locked_model = locked / ("nemotron-3-diarization" if args.engine == "nemotron3" else
                                     "sortformer" if args.engine == "sortformer" else "speaker-diarization")
            locked_model.mkdir(parents=True)
            (locked_model / "test-marker").write_text("temporary fixture")
            locked.chmod(0o500)
            try:
                denied = invoke(sidecar, "delete", "--engine", args.engine, "--models-dir", locked,
                                 expected_success=False)
                assert denied.returncode != 0 and '"deleted":true' not in denied.stdout.replace(" ", "")
                assert locked_model.exists(), "Failed deletion must not claim an absent cache."
            finally:
                locked.chmod(0o700)
            removed = invoke(sidecar, "delete", "--engine", args.engine, "--models-dir", locked)
            assert payload(removed)["deleted"] and not locked_model.exists()
            assert payload(invoke(sidecar, "delete", "--engine", args.engine,
                                  "--models-dir", locked))["deleted"], "Delete should be idempotent."
            report["isolatedCacheDeletion"] = "pass"
            assert payload(invoke(sidecar, silent, "--engine", args.engine, *model_args,
                                  *(sortformer_args if args.engine == "sortformer" else nemotron_args), env=env)) == [], "Silence must not invent a speaker."
            report["offlineMissingAndCorruptCache"] = "pass"
            report["silence"] = "pass"
            cases = [("auto", [])]
            if args.engine == "community1":
                cases.append(("knownTwoSpeakers", ["--num-speakers", "2"]))
            acceptance_cases = [label for label, _ in cases]
            if args.diagnose_thresholds and args.engine == "community1":
                cases += [(f"threshold{value}", ["--threshold", value]) for value in ("0.3", "0.6")]
            for label, extra in cases:
                print(f"Testing {label}…", flush=True)
                engine_args = community_args if args.engine == "community1" else sortformer_args if args.engine == "sortformer" else nemotron_args
                result = invoke(sidecar, fixture, "--engine", args.engine, *model_args, *engine_args, *extra, env=env)
                segments = payload(result)
                assert isinstance(segments, list), "Malformed speech segments."
                assert all(0 <= s["start_ms"] < s["end_ms"] <= len(combined) / 32 + 100 for s in segments)
                dominant, coverage = [], []
                for start, end in bounds:
                    start, end = start + 350, end - 350
                    overlap = {}
                    for segment in segments:
                        duration = max(0, min(end, segment["end_ms"]) - max(start, segment["start_ms"]))
                        overlap[segment["speaker_id"]] = overlap.get(segment["speaker_id"], 0) + duration
                    speaker = max(overlap, key=overlap.get) if overlap else None
                    dominant.append(speaker)
                    coverage.append(round(overlap.get(speaker, 0) / (end - start), 3))
                stable = dominant[0] == dominant[2] and dominant[1] == dominant[3] and dominant[0] != dominant[1]
                report[label] = {"segments": len(segments), "dominantPerTurn": dominant,
                                 "coverage": coverage, "stableTwoVoices": stable,
                                 "passed": stable and min(coverage) >= .70,
                                 "timeline": segments}
                if args.diagnostic_logs:
                    report[label]["diagnostics"] = result.stderr[-12000:]
            assert not requests, f"Unexpected registry requests: {requests}"
            report["registryRequestsDuringInference"] = len(requests)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert all(report[label]["passed"] for label in acceptance_cases), "Speaker-quality acceptance failed; see results above."


if __name__ == "__main__":
    main()
