# Desktop release acceptance

## Current product candidate

Reviewed product code is `20ff6880d253f3c9330faba310a47952fc6589bd` on `codex/windows-wasapi-capture`.

- The cross-platform Python matrix passed in [CI run 35946632805](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632805); all nine OS/Python jobs succeeded.
- Windows x64 and Apple Silicon package, install, startup, and lifecycle checks passed in [Desktop shell run 35946632808](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35946632808).
- The Apple Silicon Review Studio was exercised locally from a source-built app and matching sidecar, using an isolated temporary home and vault: load record, edit timing/speaker, split, merge, undo, redo, and normal quit with listener cleanup all passed.
- The local Python suite passed with 61 tests; `npm run frontend:build` passed. Source transcript snapshots remained unchanged through review edits.
- macOS microphone capture was not tested: the app reports `navigator.mediaDevices.getUserMedia` unavailable in the Tauri WebView. No microphone permission was requested.

| Target | Verified in the current desktop run | Artifact | GitHub ZIP SHA-256 |
|---|---|---|---|
| Windows x64 | Rust capture adapter tests; MSI install and startup smoke test | `voice-memory-x86_64-pc-windows-msvc` | `ecefea2792bba947e9e9f73545e36493bc47a8900f75fefdd59f0d8ecedc876c` |
| macOS Apple Silicon | DMG install and app startup smoke test | `voice-memory-aarch64-apple-darwin` | `a27761d1bbb0e509ac0a4e44326b27b6a673a944b9d4be9d15b91e6ce2d2c10f` |

The ZIP digests above are the GitHub Actions artifact digests for run `35946632808`. The bundles also include their generated `SHA256SUMS.txt` manifests. These are build artifacts, not a signed public release.

## Product behavior already covered

- The local service binds to loopback, rejects untrusted browser origins, and restricts record/job identifiers and note titles to safe cross-platform path components.
- Imported audio stays in the content-addressed ledger. Transcript source snapshots remain separate from reviewed records; edits are recorded as correction events.
- Review Studio supports audio-linked segment playback, 0.01-second timing edits, split/merge, speaker/status and overlap/unclear corrections, and auditable undo/redo.
- Recompilation changes only managed Markdown blocks, preserves user-authored sections, and writes rollback snapshots and diffs.
- Semantic output must cite existing transcript segment IDs and remains visibly marked as a local, unreviewed suggestion.
- The local processing sidecar starts with the desktop app and is checked during both packaged platform smoke tests.

## Remaining release gates

This is a productization candidate, not a formal public release. CI installation tests do not prove that audio capture works with a user's physical devices. Before calling the product fully accepted on either platform, exercise a real microphone recording through save, transcription, review, and Vault write on that OS. Windows additionally needs real-device WASAPI loopback tests with active playback, silence, device removal, and simultaneous microphone capture. Apple Silicon still needs native microphone capture and a permission/recovery pass; native macOS system-audio capture is not implemented.

Issue #6 remains open: assertions do not yet navigate to transcript evidence from the claim UI.

Actual Whisper and Ollama model runs, speaker diarization and voice identity review, a native Obsidian plugin, update delivery, Windows code signing, and macOS signing/notarization also remain open. The current app writes Markdown and machine-readable sidecars directly into the selected Vault; that is not a native Obsidian plugin integration.
