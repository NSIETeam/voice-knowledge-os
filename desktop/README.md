# Desktop shell

This is the Windows/macOS-first Tauri 2 shell. The release workflow bundles the Python core as a PyInstaller sidecar and the shell starts it automatically; development mode can still use a manually started Python node.

## Development

1. Install the desktop dependencies: `npm install`.
2. Generate the local icon: `python scripts/generate_icon.py`.
3. For dev mode, start the local node from the repository root: `PYTHONPATH=src python -m voice_memory.cli serve`.
4. Run `npm run dev`.

The shell proves the cross-platform process boundary and explicit offline state. Microphone capture is implemented; system-audio capture, code signing, notarization, and installer runtime acceptance remain tracked work.
