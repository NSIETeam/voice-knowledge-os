# Desktop release acceptance

## Current product candidate

The desktop source candidate is `e7d409b`; repository CI/test-harness head is `b645255`.

- Desktop shell run [#57 / 35961507456](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35961507456) passed on Windows x64 and Apple Silicon macOS, including packaged install/start/lifecycle checks.
- CI run [#87 / 35962230804](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35962230804) passed all nine OS/Python matrix jobs after making the preview-diff fixture explicitly CRLF and comparing exact newline bytes.
- CI runs #85 and #86 failed on Windows because the test used universal-newline reads (`Path.read_text`) against compiler output that intentionally preserves CRLF. This was a test-harness mismatch, not a production compiler defect. The new fixture now exercises CRLF on every host and checks preview against the exact written bytes.
- CI run [#88 / 35963002789](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35963002789) passed all 11 jobs (two Obsidian-plugin matrix jobs and nine OS/Python smoke jobs) after setting `fail-fast: false`, so Windows failures no longer cancel remaining platform/version evidence.
- These results do not cover real microphone/device recording, model inference, diarization, identity profiles, or signed public release; see the remaining release gates below.

Previous cross-platform acceptance covered product code `20ff6880d253f3c9330faba310a47952fc6589bd` on `codex/windows-wasapi-capture`.

- The cross-platform Python matrix passed in [CI run 35946632805](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632805); all nine OS/Python jobs succeeded.
- Windows x64 and Apple Silicon package, install, startup, and lifecycle checks passed in [Desktop shell run 35946632808](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632808).
- The Apple Silicon Review Studio was exercised locally from a source-built app and matching sidecar, using an isolated temporary home and vault: load record, edit timing/speaker, split, merge, undo, redo, and normal quit with listener cleanup all passed.
- The local Python suite passed with 61 tests; `npm run frontend:build` passed. Source transcript snapshots remained unchanged through review edits.

## Previous packaged candidate: `56fb396`

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

Issue #6 remains open pending packaged-app interaction acceptance. Source implementation now links current model assertions to transcript segments and audio offsets; stale analysis is hidden after transcript changes.

Actual Whisper and Ollama model runs, speaker diarization and persistent voice identity review, update delivery, Windows code signing, and macOS signing/notarization also remain open. The desktop app writes Markdown and machine-readable sidecars directly into the selected Vault; see `obsidian-plugin/README.md` for its current scope and acceptance boundaries.

## Initial Obsidian plugin implementation

- A desktop-only plugin source/package now opens records from their `voice_memory_id` frontmatter or an explicit ID, plays the immutable ledger audio with HTTP byte-range seeking, navigates claim evidence, confirms a speaker for the current record, and requests local-profile reprocessing with a resulting Markdown diff.
- The API only accepts the exact Obsidian app origin in addition to existing local clients, and audio responses expose range headers for that origin. Plugin API endpoints are restricted to localhost/loopback; no cloud path is implemented.
- Local validation: Node syntax and loopback security tests passed; Python suite 65 passed; deterministic plugin ZIP contents verified. The package is not yet accepted inside the installed Obsidian app.
- The plugin was not yet accepted inside the installed Obsidian app. Speaker confirmation is per-record only; persistent voice profiles are not implemented.

## Approval-before-write candidate

- `POST /records/<id>/reprocess` now renders a read-only preview of every affected Markdown note and returns an expiring approval token. Approval is idempotent, so a client can safely retry if the response is lost; it writes only once. Cancelling or closing the preview discards an unapproved token; no note, sidecar, rollback snapshot, or diff is written by the preview request.
- `POST /records/<id>/reprocess/approve` verifies that the record sidecar and every affected note still match the preview-time SHA-256 values before writing. A stale record or user-edited note returns HTTP 409; an expired or cancelled token returns HTTP 410. The complete preview is capped at 1 MB to avoid asking the user to approve a truncated diff.
- The desktop Review Studio and Obsidian plugin now present all affected note diffs with explicit approve and cancel actions. The actual write retains the existing rollback snapshots and compiler-owned block boundaries.
- Local regression coverage verifies read-only preview, exact preview-to-write Markdown diffs, user-content preservation, cancellation, idempotent approval, and refusal after either the record or a note changes. Packaged desktop and installed Obsidian interaction still need separate acceptance after the candidate commit's CI run.

## Current UI candidate (`23f7efb`)

- Current analysis views are exposed to the desktop UI only when their source transcript fingerprint matches the current record. Stale views remain in the sidecar for provenance but are not presented as current candidates.
- Model summaries and findings link to the cited transcript segments. Selecting evidence scrolls to and highlights the source segment and seeks/plays its audio range.
- Unsaved edits suspend candidate display with a clear stale-evidence explanation. This implementation does not itself close Issue #6: validate the interaction in the packaged app and retain the remaining platform/device acceptance gates.
- Python suite: 61 passed. Frontend production build passed. Python GitHub matrix run `35952304107` passed. Desktop workflow `35952304056` passed on Windows x64 and Apple Silicon macOS, including capture-adapter tests, packaged install/start/quit smoke checks, and artifact upload.
- The Miraphant compound logo asset is now used by the desktop UI. The deep-green identity color is `#1B3D32`; logo artwork was sourced from the local Miraphant brand asset already available in the user's workspace.
- This is CI/package-lifecycle evidence, not real-device acceptance. Physical microphone recording, Windows playback loopback cases, model inference, and packaged Review Studio interaction remain separate release gates.
