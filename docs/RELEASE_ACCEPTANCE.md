# Desktop release acceptance

## Current product candidate

Previous cross-platform acceptance covered product code `20ff6880d253f3c9330faba310a47952fc6589bd` on `codex/windows-wasapi-capture`.

- The cross-platform Python matrix passed in [CI run 35946632805](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632805); all nine OS/Python jobs succeeded.
- Windows x64 and Apple Silicon package, install, startup, and lifecycle checks passed in [Desktop shell run 35946632808](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632808).
- The Apple Silicon Review Studio was exercised locally from a source-built app and matching sidecar, using an isolated temporary home and vault: load record, edit timing/speaker, split, merge, undo, redo, and normal quit with listener cleanup all passed.
- The local Python suite passed with 61 tests; `npm run frontend:build` passed. Source transcript snapshots remained unchanged through review edits.

## Latest local candidate: `56fb396`

- Apple Silicon native microphone capture now uses CoreAudio through CPAL; float32 samples are stored directly and int16 samples are converted to float WAV. The app bundle includes a Chinese `NSMicrophoneUsageDescription`. Audio is written to a recoverable cache WAV before upload to the local ledger, and the cache is removed only after the ledger confirms the upload.
- A local `aarch64-apple-darwin` `.app` and DMG were built. The installed copy passed the package smoke test: permission-purpose key present, app-owned loopback API started with all seven profiles, and normal quit removed the listener and sidecar.
- The smoke test originally failed because local `/tmp` resolves through a symlink and Tauri refuses sidecar resolution through that path. Canonicalizing the isolated smoke root fixed the harness; the final DMG install test passed.
- Verification: Python suite 61/61; Rust macOS library tests 2/2; macOS `cargo check`; frontend production build; Rust formatting; DMG install/start/quit smoke test.
- GitHub desktop workflow [run 35949960645](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35949960645) passed on both macOS 14 / Apple Silicon and Windows x64. This includes Windows capture-adapter Rust tests, Windows MSI installation/start smoke, and the Apple Silicon DMG installation/start/normal-quit smoke.
- The nine-job Python OS/Python-version matrix passed in [run 35949960681](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35949960681).
- The microphone permission prompt and actual microphone recording/save/transcribe flow were deliberately not exercised. No microphone authorization was requested. Windows CI validates packaging/lifecycle, not real hardware capture.

Local DMG: `desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Voice Memory_0.1.0_aarch64.dmg`

SHA-256: `468782b43e8311db6ea020bd2d40408af736835d848bc6405ddb14563e6f4f9e`

| GitHub Actions artifact | SHA-256 of artifact ZIP |
|---|---|
| `voice-memory-aarch64-apple-darwin` ([run 35949960645](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35949960645)) | `4307cc2887a8ce7f3383cb32f0c930706270732d3c5a47ba5d89b12fbababa3a` |
| `voice-memory-x86_64-pc-windows-msvc` ([run 35949960645](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35949960645)) | `6adf9863d4f0462eec507b705d72d7738f0feafa81856641b76bc7861bb537c1` |

| Target | Verified in the current desktop run | Artifact | GitHub ZIP SHA-256 |
|---|---|---|---|
| Windows x64 | Rust capture adapter tests; MSI install and startup smoke test | `voice-memory-x86_64-pc-windows-msvc` | `ecefea2792bba947e9e9f73545e36493bc47a8900f75fefdd59f0d8ecedc876c` |
| macOS Apple Silicon | DMG install and app startup smoke test | `voice-memory-aarch64-apple-darwin` | `a27761d1bbb0e509ac0a4e44326b27b6a673a944b9d4be9d15b91e6ce2d2c10f` |

The ZIP digests above are the GitHub Actions artifact digests for run `35946632808`. The bundles also include their generated `SHA256SUMS.txt` manifests. These are build artifacts, not a signed public release.

## Product behavior already covered

- The local service binds to loopback, rejects untrusted browser origins, and restricts record/job identifiers and note titles to safe cross-platform path components.
- Imported audio stays in the content-addressed ledger. Transcript source snapshots remain separate from reviewed records; edits are recorded as correction events.
- Review Studio supports audio-linked segment playback, 0.01-second timing edits, split/merge, speaker/status and overlap/unclear corrections, and auditable undo/redo.
- Apple Silicon desktop microphone capture uses native CoreAudio; Windows system playback capture uses WASAPI loopback. Both preserve a separate audio asset and provenance in the local ledger.
- Recompilation changes only managed Markdown blocks, preserves user-authored sections, and writes rollback snapshots and diffs.
- Semantic output must cite existing transcript segment IDs and remains visibly marked as a local, unreviewed suggestion.
- The local processing sidecar starts with the desktop app and is checked during both packaged platform smoke tests.

## Remaining release gates

This is a productization candidate, not a formal public release. CI installation tests do not prove that audio capture works with a user's physical devices. Before calling the product fully accepted on either platform, exercise a real microphone recording through save, transcription, review, and Vault write on that OS, including macOS permission grant/denial and recovery. Windows additionally needs real-device WASAPI loopback tests with active playback, silence, device removal, and simultaneous microphone capture. Native macOS system-audio capture is not implemented.

Issue #6 remains open: assertions do not yet navigate to transcript evidence from the claim UI.

Actual Whisper and Ollama model runs, speaker diarization and voice identity review, a native Obsidian plugin, update delivery, Windows code signing, and macOS signing/notarization also remain open. The current app writes Markdown and machine-readable sidecars directly into the selected Vault; that is not a native Obsidian plugin integration.
