# Desktop release acceptance

Evidence for product commit `5d8ad08` is the full 9-job Python matrix in [run 35167805609](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35167805609) and the desktop packaging/installer run [35167805558](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35167805558). macOS Apple Silicon continues to use the previously accepted local artifact; current product and acceptance focus is Windows x64.

The evidence above predates the local semantic-processing implementation in `f2515ac`. The current Windows workflow is being strengthened to verify the installed app's sidecar health, profile API, and graceful sidecar shutdown; those new gates have not run yet. The prior green MSI smoke must not be treated as acceptance of `f2515ac` or the updated workflow.

| Target | Result | Artifact |
|---|---|---|
| macOS Apple Silicon | Build and bundle passed | `voice-memory-aarch64-apple-darwin` |
| Windows x64 | Build, MSI bundle, install, and launch smoke test passed | `voice-memory-x86_64-pc-windows-msvc` |

The generated artifacts were downloaded and inspected locally:

- macOS application and bundled sidecar: Mach-O 64-bit arm64
- Windows package: Windows Installer MSI, x64 template
- The macOS sidecar was executed on an Apple Silicon host with `--help`, then started on loopback using a temporary data directory.
- Local runtime checks passed for `/health`, `/profiles`, and `/records/compile`; the latter wrote a timestamped, evidence-linked Markdown record into a temporary vault.
- The packaged macOS app was launched locally; its bundled sidecar process appeared automatically and the UI reported `本地处理节点正常` after re-checking.
- Both platform jobs run the packaged sidecar with `--help` before building the installer; this verifies that the PyInstaller executable is runnable on the target runner.
- The desktop workflow uses the committed npm lockfile with `npm ci` for reproducible frontend dependencies.
- The Windows MSI artifact was downloaded independently and its bundled `SHA256SUMS.txt` verified successfully with `sha256sum -c`.
- The Windows workflow installed the MSI silently on a Windows runner, located the installed executable, launched it, confirmed that it remained running for the smoke-test window, and then terminated the test process.
- This build includes the Review Studio desktop UI and its local correction API; the frontend production bundle and both platform desktop builds completed successfully.
- The Review Studio can seek to a segment offset in a ledger-backed source audio asset; the loopback API was independently tested with an HTTP byte-range request and returned the requested partial content.
- The original ASR transcript is stored write-once under `.voice-memory/transcripts/` separately from reviewed record sidecars and correction events.
- The full test suite passed on Windows, macOS, and Ubuntu for Python 3.11, 3.12, and 3.13: 24 tests per matrix job, including Vault managed-block preservation, malformed-block refusal, rollback, diff, CRLF, and untrusted-Origin API write-rejection tests.
- The desktop shell requests termination of its own sidecar on window teardown; a separate packaged-install exit/relaunch test is still required on each target OS.
- The independently downloaded Windows MSI from run `35167805558` has SHA-256 `3b81844c3e50972488b5c4e8ae988cd26b9cfc02dd133d85c6694eab20405b32`; its bundled manifest check passed.
- Recompilation now updates only Voice Memory managed blocks; user-authored content between those blocks is preserved, malformed boundaries and pre-existing unmanaged notes fail closed, and overwrites get atomic writes, rollback copies, and a unified diff under `.voice-memory/diffs/`.
- The loopback API rejects requests from untrusted browser Origins; JSON routes reject simple non-JSON content types, closing the tested cross-origin write path while keeping CORS allowlisted.
- Artifact hashes are recorded in the run's downloaded files; a signed release hash manifest is still required before public distribution.

This is a productization milestone, not a formal public release. The artifacts are unsigned/notarization-unverified. macOS Apple Silicon has a local install/runtime smoke test; Windows has a CI install/launch smoke test, but no physical Windows audio-device acceptance has been performed here. System-audio capture, real-model Windows inference, diarization, the native Obsidian plugin, update delivery, and signed distribution remain open product work. The desktop currently writes Markdown and machine-readable sidecars directly into a selected Vault; that is not equivalent to a complete Obsidian plugin integration.
