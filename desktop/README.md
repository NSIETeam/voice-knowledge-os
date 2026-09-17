# Desktop shell

This is the Windows/macOS-first Tauri 2 shell. The release workflow bundles the Python core as a PyInstaller sidecar and the shell starts it automatically; development mode can still use a manually started Python node.

The desktop workflow builds and checks both Windows x64 and Apple Silicon macOS packages. Mac validation launches the bundled app with an isolated home folder and checks its local service lifecycle.

## Development

1. Install the desktop dependencies: `npm install`.
2. Generate the local icon: `python scripts/generate_icon.py`.
3. For dev mode, start the local node from the repository root: `PYTHONPATH=src python -m voice_memory.cli serve`.
4. Run `npm run dev`.

The desktop flow supports microphone capture, streamed audio import into the content-addressed ledger, local asynchronous transcription, and compilation into a selected Obsidian Vault. In the settings panel choose a locally installed `whisper-cli` executable, model file, and FFmpeg executable (needed for browser-recorded WebM and WAVs not already mono 16 kHz signed-16-bit PCM, including Windows WASAPI capture). Optionally configure an Ollama service on loopback and a locally installed model; the core makes a single non-streaming, schema-constrained request, bypasses environment proxies and redirects, and rejects output without valid transcript segment citations. The generated note labels every model-derived result as an unreviewed suggestion. With no semantic model configured, it explicitly emits transcript and evidence only.

Audio bytes, model paths, Vault paths, and transcripts remain on the local machine. Reprocessing a record with a different profile creates a separate view and retains the original profile and previous profile analyses; transcript corrections mark derived views stale until reprocessed. Neither Ollama nor model weights are bundled, and actual model inference must be accepted separately on the target Windows machine. The generated record opens in Review Studio with segment evidence playback and auditable corrections.

On Windows, the shell captures the default render device through WASAPI loopback into a separate IEEE-float WAV asset, then streams it to the local ledger with `system-audio-loopback` provenance. This is independent of the browser microphone capture button. A Windows hardware pass is still required for real playback, silence intervals, device removal, failure recovery, and simultaneous microphone/system recording. macOS native system-audio capture, diarization, split/merge/undo review operations, code signing, notarization, and signed update delivery remain tracked work.
