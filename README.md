# Voice Memory

Voice Memory is a local-first voice knowledge system. It turns a Conversation Record into evidence-linked, editable Obsidian Markdown; optional local-model output stays visibly provisional and is never treated as a source of truth.

> 不是帮你记会议，而是让现实世界中说过的话，成为可以查证、连接、积累和继续执行的知识。

## Why this repository exists

The product is intentionally split into replaceable layers:

`Capture → Audio Ledger → ASR/Diarization → Human Review → Semantic Compiler → Obsidian → Execution adapters`

The repository includes local whisper.cpp transcription and an optional Ollama semantic-processor adapter. It does not bundle either model runtime or model weights, and speaker diarization/voice identity are not yet implemented.

The local API and content-addressed audio ledger are now included. Start the API with `PYTHONPATH=src python -m voice_memory.cli serve .voice-memory`; it exposes a local status page, `GET /health`, `GET /profiles`, `GET /jobs/<id>`, `GET /records/<id>`, `POST /ledger/import`, streaming `POST /ledger/upload`, asynchronous `POST /transcribe`, `POST /records/from-job`, `POST /records/<id>/corrections`, `POST /records/<id>/reprocess`, and `POST /records/compile`. The desktop shell captures microphone audio or imports a local audio file, streams it only to the loopback ledger, then starts a persisted local transcription job and compiles the completed transcript into a user-selected Vault. System-audio capture remains a separate native adapter task. The API binds to loopback by default and stores imported bytes under a hash-addressed object path. Production ASR providers implement the same interface; the local `whisper.cpp` subprocess adapter never receives or logs API keys.

The desktop shell supports microphone capture and streaming audio-file import to the local ledger, then asynchronous transcription and record compilation into a user-selected Obsidian Vault. Choose a local `whisper-cli` executable and model in the app; browser-recorded WebM and formats outside the decoder's WAV/MP3/FLAC/OGG set are normalized to 16 kHz mono WAV using a local FFmpeg executable. Vault, model, and executable paths remain local desktop settings. Optionally configure a loopback Ollama endpoint and an already-installed model. The adapter sends a single structured request to that local service, requires every summary/finding to cite existing transcript segment IDs, rejects unknown citations/categories, and labels accepted output as an unreviewed suggestion. If no model is configured, the compiler explicitly emits transcript/evidence only rather than placeholder summaries or tasks. Ollama is not bundled; the request must be tested with an actual installed model before calling semantic inference hardware-accepted.

The desktop shell now includes a local Review Studio. Load a compiled record by ID with `GET /records/<id>`, seek and play its immutable ledger audio through the byte-range-enabled `GET /ledger/<asset-id>/content`, then submit `POST /records/<id>/corrections` for text edits, speaker relabeling, overlap flags, or unclear markers. Every correction stores an event with before/after values in the sidecar and recompiles the Markdown record with the review state visible. The original audio and prior Markdown snapshots remain separate from the correction history; records should set `audio_asset_id` when they are compiled from a ledger asset.

The first compile also creates `.voice-memory/transcripts/<record-id>.json` with schema `voice-memory.transcript.v1`. It is write-once source ASR output, separate from corrected record sidecars and correction events; review corrections never replace this baseline transcript.

The design is informed by open-source projects including [Humla](https://github.com/michaelwilhelmsen/humla) (MIT, local two-stream capture and speaker processing) and [VaultScribe](https://github.com/Junyi-Tang/vaultscribe) (Chinese/English transcription, diarization, and Obsidian export). Their licenses and upstream boundaries must be preserved when adapters are added.

## Run the first slice

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
voice-memory profiles
voice-memory demo /tmp/voice-memory-vault
pytest
```

For environments without pytest, run `make smoke`.

Desktop build evidence and remaining release gaps are tracked in [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md).

The demo writes `Recordings/2026-09-16 产品讨论.md`. The file contains YAML metadata, managed sections, transcript segment IDs, confidence, and Obsidian block references back to the source segment.

Each compiled record also writes a machine-readable sidecar at
`.voice-memory/recordings/<record-id>.json`. The sidecar is versioned, keeps the
record and processing contract separate from Markdown, optionally records the
source audio SHA-256, and preserves a Markdown snapshot under
`.voice-memory/rollback/<record-id>/` before a recompile. This is the stable
boundary for a future Obsidian plugin and review UI; raw audio and sensitive
speaker profiles remain outside ordinary Markdown.

## Product contracts

- Raw audio and raw transcript are immutable inputs.
- A speaker match is a suggestion until a human confirms it.
- A conclusion without an evidence reference is provisional.
- Recompilation only owns `voice-memory:managed` blocks; user-authored Markdown is not overwritten.
- Sensitive voice profiles are not stored in the ordinary Vault by default.
- Capture and processing are separate so desktop, mobile, private nodes, and cloud providers can be mixed explicitly.

## Roadmap

The detailed implementation backlog is in [docs/ISSUES.md](docs/ISSUES.md). Issues are ordered by acceptance dependency, not by marketing surface area.
