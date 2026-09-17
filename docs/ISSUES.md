# GitHub issue backlog

These are ready-to-file issues for the new repository. Each issue has a bounded outcome and acceptance evidence.

## 1. Repository contracts and provenance

**Labels:** `foundation`, `good first issue`

### Goal
Document the license boundary, source provenance, data model, and provider adapter contract.

### Acceptance criteria

- README links to every upstream project whose code or design is used.
- `ConversationRecord`, `Segment`, and processing-profile schemas are versioned.
- A fixture can be replayed without network access.
- CI runs tests on Python 3.11+.

## 2. Immutable audio ledger

**Labels:** `core`, `privacy`

### Goal
Store an imported recording as an immutable, hashed source with provenance and sensitivity metadata.

### Acceptance criteria

- Importing the same bytes twice yields the same content hash and no duplicate source.
- The ledger records path, size, media duration, created time, hash, and consent/sensitivity state.
- Raw audio is never copied into Markdown.
- A failed import leaves no partial ledger entry.

## 3. Pluggable ASR provider interface

**Labels:** `core`, `transcription`

### Goal
Add local Whisper/whisper.cpp and optional OpenAI-compatible providers behind one interface.

### Acceptance criteria

- Provider output is normalized to word/segment timestamps, language, model name, and confidence.
- Offline fixture mode works with no API key and no network.
- Provider failures are persisted as retryable states, not silently converted to empty notes.
- API keys never appear in logs or sidecars.

## 4. Speaker diarization and overlap review

**Labels:** `core`, `speaker-id`

### Goal
Integrate a replaceable local diarization adapter and represent overlap/unknown speakers explicitly.

### Acceptance criteria

- A segment can have one or more speaker labels and an overlap flag.
- Low-confidence identity is rendered as a suggestion, never as a confirmed person.
- Split, merge, relabel, and “unclear” operations are recorded as an auditable correction event.
- A correction can be replayed against a new transcript without losing the original output.

## 5. Human speaker confirmation and voice profiles

**Labels:** `speaker-id`, `privacy`

### Goal
Let a user map a local speaker cluster to an Obsidian person link for this record or future records.

### Acceptance criteria

- Supports `this_record_only`, `remember_voice`, and `reject_suggestion`.
- Stores who confirmed, when, confidence before confirmation, and source recording ID.
- Multiple voice samples per person are supported.
- Voice embeddings are encrypted or kept outside the ordinary Vault by default.

## 6. Review Studio

**Labels:** `ui`, `core`

### Goal
Build the timeline editor for evidence-first transcript review.

### Acceptance criteria

- Clicking a segment seeks to its source audio offset.
- Text edits, relabels, split/merge, overlap, and unclear markers are undoable.
- Each displayed assertion can navigate to its transcript evidence.
- The UI visibly distinguishes confirmed identity, suggestion, unknown, and overlap.

## 7. Processing profile compiler

**Labels:** `semantic`, `obsidian`

### Goal
Turn one immutable record into multiple processing views without duplicating or mutating the source.

### Acceptance criteria

- Ships knowledge, decision, interview, negotiation, relationship, evidence, and operations profiles.
- Profile output lists the extraction contract and evidence references.
- Re-running a profile updates only managed blocks.
- A user-authored block remains byte-for-byte unchanged.
- Optional local-model output is clearly marked as unreviewed; every summary/finding must cite valid source segment IDs and invalid citations are rejected.
- A missing local model produces an explicit transcript-only note, never a fabricated summary or task.
- The local processor endpoint is restricted to loopback; cloud processing is never an implicit fallback.

## 8. Obsidian sidecar protocol and preview changes

**Labels:** `obsidian`, `privacy`

### Goal
Write human-readable Markdown plus machine-readable sidecars and present a reviewable change set.

### Acceptance criteria

- Sidecars include schema version, source hash, model/provider versions, and correction history.
- Generated links use Wikilinks and stable block IDs.
- Proposed updates to People/Companies/Projects are previewed before writing.
- Every accepted write has a rollback snapshot and a diff.

## 9. Obsidian plugin shell

**Labels:** `obsidian`, `ui`

### Goal
Open a record from Obsidian, play evidence, confirm speakers, and recompile a section.

### Acceptance criteria

- Plugin never assumes a specific Vault folder layout beyond configurable paths.
- It can open the source audio and jump to a block ID.
- It can request a profile recompile and display the resulting diff.
- It works without a cloud account.

## 10. Desktop capture adapters

**Labels:** `capture`, `macos`, `windows`

### Goal
Add microphone and system-audio capture using platform-native adapters, retaining separate streams.

### Acceptance criteria

- Mic and system streams remain separately identifiable in the ledger.
- Permission denial is actionable and does not lose an in-progress recording.
- Start/stop/recovery behavior is covered by a real device test matrix.
- The capture adapter is replaceable and does not leak OS-specific paths into the core schema.

## 11. ClawMaster execution boundary

**Labels:** `integration`, `security`

### Goal
Expose only user-approved commitments and tasks to ClawMaster.

### Acceptance criteria

- No external action is triggered by compilation alone.
- User sees the exact evidence and fields before export.
- Export is idempotent and records destination, timestamp, and result.
- Private conversation profiles cannot silently enter enterprise execution.

## 12. Release and acceptance matrix

**Labels:** `release`, `qa`

### Goal
Publish a reproducible release with evidence across capture, processing, review, Obsidian, and rollback.

### Acceptance criteria

- CI artifacts include hashes and schema versions.
- macOS/Windows/Linux capture status is reported separately.
- Local-only and provider-backed paths are tested separately.
- Windows MSI smoke installs and launches the app, verifies the bundled sidecar health/profile API, and confirms the sidecar exits when the desktop closes.
- A release is not called cross-platform until each platform has a real capture and review pass.
