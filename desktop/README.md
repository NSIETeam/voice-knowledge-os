# Desktop shell

This is the Windows/macOS-first Tauri 2 shell. The release workflow bundles the Python core as a PyInstaller sidecar and the shell starts it automatically; development mode can still use a manually started Python node.

## Development

1. Install the desktop dependencies: `npm install`.
2. Generate the local icon: `python scripts/generate_icon.py`.
3. For dev mode, start the local node from the repository root: `PYTHONPATH=src python -m voice_memory.cli serve`.
4. Run `npm run dev`.

The desktop flow supports microphone capture, streamed audio import into the content-addressed ledger, local asynchronous transcription, and compilation into a selected Obsidian Vault. In the settings panel choose a locally installed `whisper-cli` executable, model file, and FFmpeg executable (needed for browser-recorded WebM and formats not decoded directly by whisper.cpp). Optionally configure an Ollama service on loopback and a locally installed model; the core makes a single non-streaming, schema-constrained request, bypasses environment proxies and redirects, and rejects output without valid transcript segment citations. The generated note labels every model-derived result as an unreviewed suggestion. With no semantic model configured, it explicitly emits transcript and evidence only.

Audio bytes, model paths, Vault paths, and transcripts remain on the local machine. Neither Ollama nor model weights are bundled, and actual model inference must be accepted separately on the target Windows machine. The generated record opens in Review Studio with segment evidence playback and auditable corrections.

System-audio capture, real-device recording acceptance, diarization, split/merge/undo review operations, code signing, notarization, and signed update delivery remain tracked work.
