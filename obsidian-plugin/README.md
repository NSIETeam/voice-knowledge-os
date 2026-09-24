# Voice Memory Obsidian plugin

This desktop-only Obsidian plugin connects to the Voice Memory API over loopback. It never sends data to a cloud service.

## Install for local testing

1. Build or install the Voice Memory desktop app and start it so its local API is listening on `127.0.0.1:8765`.
2. Copy `main.js`, `loopback.js`, `manifest.json`, `styles.css`, and `versions.json` from this directory (or the CI plugin ZIP) into `<Vault>/.obsidian/plugins/voice-memory-local/`.
3. In Obsidian, enable **Voice Memory** under Community plugins, then open its settings and use **连接检查**.
4. Open a generated note and choose **在 Voice Memory 中复核**, or run **打开语音记录与证据** from the command palette and enter a record ID.

The plugin reads `voice_memory_id` from note frontmatter, so it does not require a fixed `Recordings/` directory. API and Ollama URLs are configurable but are restricted to localhost/loopback. Recompile now follows a preview-before-write flow: the API returns the complete diffs for all affected notes without changing the Vault, and the user must approve those diffs in a modal before any write occurs. The expiring preview is bound to the record sidecar and all affected note hashes; if anything changes before approval, the API refuses the write and asks for a fresh preview. Closing the modal discards the preview. Speaker confirmation applies only to the current record; persistent voice profiles are not implemented.

## Current scope

- Open a record by ID or from a generated note's `voice_memory_id` frontmatter.
- Play the original ledger audio and jump to transcript segment offsets.
- Inspect current, evidence-linked local model candidates.
- Confirm a speaker label for this record and preserve that correction in the sidecar.
- Recompile a processing profile with local Ollama, inspect every affected note, then approve or discard the preview.

The API binds to loopback and allows only explicit local app origins. The plugin's audio stream uses the exact Obsidian desktop origin `app://obsidian.md`; request URLs reject non-loopback hosts.
