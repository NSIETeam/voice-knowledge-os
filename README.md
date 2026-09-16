# Voice Memory

Voice Memory is a local-first voice knowledge compiler. It turns a Conversation Record into evidence-linked, editable Obsidian Markdown without pretending that an AI summary is a source of truth.

> 不是帮你记会议，而是让现实世界中说过的话，成为可以查证、连接、积累和继续执行的知识。

## Why this repository exists

The product is intentionally split into replaceable layers:

`Capture → Audio Ledger → ASR/Diarization → Human Review → Semantic Compiler → Obsidian → Execution adapters`

The first vertical slice in this repository implements the protocol and compiler boundary. It does not claim to ship a production-grade Whisper or speaker-embedding model yet.

The local API and content-addressed audio ledger are now included. Start the API with `PYTHONPATH=src python -m voice_memory.cli serve .voice-memory`; it exposes a local status page, `GET /health`, `GET /profiles`, `POST /ledger/import`, `POST /ledger/upload`, `POST /transcribe` (deterministic fixture provider), and `POST /records/compile`. The desktop shell can capture microphone audio through the OS permission prompt and upload it only to the loopback ledger. System-audio capture remains a separate native adapter task. The API binds to loopback by default and stores imported bytes under a hash-addressed object path. Production ASR providers implement the same interface; a safe `whisper.cpp` subprocess adapter is included.

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
