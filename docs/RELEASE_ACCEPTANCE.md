# Desktop release acceptance

Evidence for the current desktop milestone is GitHub Actions run [35089440712](https://github.com/NSIETeam/voice-knowledge-os/actions/runs/35089440712).

| Target | Result | Artifact |
|---|---|---|
| macOS Apple Silicon | Build and bundle passed | `voice-memory-aarch64-apple-darwin` |
| Windows x64 | Build and MSI bundle passed | `voice-memory-x86_64-pc-windows-msvc` |

The generated artifacts were downloaded and inspected locally:

- macOS executable: Mach-O 64-bit arm64
- Windows package: Windows Installer MSI, x64 template
- Artifact hashes are recorded in the run's downloaded files; a signed release hash manifest is still required before public distribution.

This is a build acceptance milestone, not a formal release. The artifacts are unsigned/notarization-unverified, and the Python processing node is not yet embedded as a packaged sidecar. The installer currently proves the desktop shell, not a zero-dependency end-to-end install.

