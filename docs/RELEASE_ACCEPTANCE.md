# Desktop release acceptance

## Current product candidate

The current branch is `codex/windows-wasapi-capture`, at `6d0bee23abf08106b3b93a7a23b73a1d721fc0c8`. The platform packages were built from `5ecfdc01eb1598db79aa8cd354ea1465ee092861`; the only later commit adds an API-level path-traversal regression test and does not change packaged application code.

- The nine-job Python matrix for the current head passed in [CI run 35938773997](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35938773997).
- Windows x64 and Apple Silicon package, install, launch, and lifecycle checks passed in [Desktop shell run 35938544448](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35938544448).
- The local Python suite passed with 56 tests. `npm run frontend:build` passed; the production bundle contains 13.21 kB HTML, 19.18 kB CSS, and 35.70 kB JavaScript before gzip.

| Target | Verified in the current desktop run | Artifact | GitHub ZIP SHA-256 |
|---|---|---|---|
| Windows x64 | Rust capture adapter tests; MSI build; installed-app launch and sidecar lifecycle smoke | `voice-memory-x86_64-pc-windows-msvc` | `75a4f48e4c41649c7c42b78173dd8596608821c29ed40f8edd37ff090071efd1` |
| macOS Apple Silicon | App build; package install/launch; local service health/profile checks; normal exit and sidecar cleanup | `voice-memory-aarch64-apple-darwin` | `9a7914389f733fc028b5026f387c6c45bac934ee98e67142cb8fbcad4d96fbdf` |

The ZIP digests above are the GitHub Actions artifact digests for run `35938544448`. The bundles also include their generated `SHA256SUMS.txt` manifests. These are build artifacts, not a signed public release.

## Product behavior already covered

- The local service binds to loopback, rejects untrusted browser origins, and restricts record/job identifiers and note titles to safe cross-platform path components.
- Imported audio stays in the content-addressed ledger. Transcript source snapshots remain separate from reviewed records; edits are recorded as correction events.
- Recompilation changes only managed Markdown blocks, preserves user-authored sections, and writes rollback snapshots and diffs.
- Semantic output must cite existing transcript segment IDs and remains visibly marked as a local, unreviewed suggestion.
- The local processing sidecar starts with the desktop app and is checked during both packaged platform smoke tests.

## Remaining release gates

This is a productization candidate, not a formal public release. CI installation tests do not prove that audio capture works with a user's physical devices. Before calling the product fully accepted on either platform, exercise a real microphone recording through save, transcription, review, and Vault write on that OS. Windows additionally needs real-device WASAPI loopback tests with active playback, silence, device removal, and simultaneous microphone capture. Apple Silicon still needs a real microphone permission/recovery pass; native macOS system-audio capture is not implemented.

Actual Whisper and Ollama model runs, speaker diarization and voice identity review, a native Obsidian plugin, update delivery, Windows code signing, and macOS signing/notarization also remain open. The current app writes Markdown and machine-readable sidecars directly into the selected Vault; that is not a native Obsidian plugin integration.
