# Desktop shell

This is the Windows/macOS-first Tauri 2 shell. It is intentionally thin: the Python core remains the local processing node, and the shell talks to it only through `127.0.0.1:8765`.

## Development

1. Start the local node from the repository root: `PYTHONPATH=src python -m voice_memory.cli serve .voice-memory`.
2. Install the desktop dependencies: `npm install`.
3. Run `npm run dev`.

The shell currently proves the cross-platform process boundary and explicit offline state. It is not yet a release artifact: microphone/system-audio capture, packaged Python runtime, code signing, and installer acceptance remain tracked work.

