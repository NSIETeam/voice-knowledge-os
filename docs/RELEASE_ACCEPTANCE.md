# Desktop release acceptance

## Current product candidate

The current branch is `codex/windows-wasapi-capture`, at `cec7315ad98c4d3cdf9500886cfe343f23d7744c`.

- The nine-job Python matrix for this commit passed in [CI run 35941684949](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35941684949).
- Windows x64 and Apple Silicon package, install, startup, and lifecycle checks passed in [Desktop shell run 35941685003](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35941685003).
- The Apple Silicon DMG from that run was also checksum-verified and installed/launched on this Mac in an isolated temporary home. The UI, local API, seven profiles, sidecar ownership, and clean normal-quit cleanup passed; no microphone permission was requested.
- The local Python suite passed with 56 tests. `npm run frontend:build` passed. The refreshed interface keeps Miraphant's forest-and-paper palette, improves control legibility, and names missing transcription prerequisites.

| Target | Verified in the current desktop run | Artifact | GitHub ZIP SHA-256 |
|---|---|---|---|
| Windows x64 | Rust capture adapter tests; MSI install; exact installed-app startup; normal close, restart, forced exit, uninstall, and process cleanup | `voice-memory-x86_64-pc-windows-msvc` | `9c3c638b7cdc9ac930f042434b5555a2db3196671c9b455a6d6f2df0ee192474` |
| macOS Apple Silicon | DMG install; app startup; local service health/profile checks; normal quit and sidecar cleanup | `voice-memory-aarch64-apple-darwin` | `d18206599c3e765cbc0d9a3810c55d17bf3d89d66edf56de673e931466c808b5` |

The ZIP digests above are the GitHub Actions artifact digests for run `35941685003`. The bundles also include their generated `SHA256SUMS.txt` manifests. These are build artifacts, not a signed public release.

## Product behavior already covered

- The local service binds to loopback, rejects untrusted browser origins, and restricts record/job identifiers and note titles to safe cross-platform path components.
- Imported audio stays in the content-addressed ledger. Transcript source snapshots remain separate from reviewed records; edits are recorded as correction events.
- Recompilation changes only managed Markdown blocks, preserves user-authored sections, and writes rollback snapshots and diffs.
- Semantic output must cite existing transcript segment IDs and remains visibly marked as a local, unreviewed suggestion.
- The local processing sidecar starts with the desktop app and is checked during both packaged platform smoke tests.

## Remaining release gates

This is a productization candidate, not a formal public release. CI installation tests do not prove that audio capture works with a user's physical devices. Before calling the product fully accepted on either platform, exercise a real microphone recording through save, transcription, review, and Vault write on that OS. Windows additionally needs real-device WASAPI loopback tests with active playback, silence, device removal, and simultaneous microphone capture. Apple Silicon still needs a real microphone permission/recovery pass; native macOS system-audio capture is not implemented.

Actual Whisper and Ollama model runs, speaker diarization and voice identity review, a native Obsidian plugin, update delivery, Windows code signing, and macOS signing/notarization also remain open. The current app writes Markdown and machine-readable sidecars directly into the selected Vault; that is not a native Obsidian plugin integration.
