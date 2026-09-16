from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .compiler import write_compiled, write_source_transcript_snapshot
from .models import ConversationRecord, Segment


VALID_OPERATIONS = {"edit_text", "relabel", "mark_overlap", "mark_unclear"}
VALID_SPEAKER_STATUS = {"confirmed", "suggestion", "unknown"}


def _record_from_sidecar(sidecar: dict[str, Any]) -> ConversationRecord:
    data = dict(sidecar["record"])
    record = ConversationRecord(**{key: value for key, value in data.items() if key != "segments"})
    record.segments = [Segment(**segment) for segment in data.get("segments", [])]
    return record


def load_sidecar(data_root: str | Path, record_id: str) -> tuple[Path, dict[str, Any]]:
    path = Path(data_root) / "recordings" / f"{record_id}.json"
    if not path.is_file():
        raise FileNotFoundError(record_id)
    return path, json.loads(path.read_text(encoding="utf-8"))


def apply_correction(data_root: str | Path, record_id: str, operation: dict[str, Any]) -> dict[str, Any]:
    name = operation.get("type")
    if name not in VALID_OPERATIONS:
        raise ValueError(f"unsupported correction: {name}")
    path, sidecar = load_sidecar(data_root, record_id)
    record = _record_from_sidecar(sidecar)
    if record.id != record_id:
        raise ValueError("record id does not match sidecar")
    vault = path.parent.parent.parent
    write_source_transcript_snapshot(record, vault)
    segment_id = operation.get("segment_id")
    segment = next((item for item in record.segments if item.id == segment_id), None)
    if segment is None:
        raise ValueError(f"segment not found: {segment_id}")

    before = asdict(segment)
    if name == "edit_text":
        text = operation.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must be a non-empty string")
        segment.text = text.strip()
    elif name == "relabel":
        speaker = operation.get("speaker")
        status = operation.get("speaker_status", "confirmed")
        if not isinstance(speaker, str) or not speaker.strip():
            raise ValueError("speaker must be a non-empty string")
        if status not in VALID_SPEAKER_STATUS:
            raise ValueError(f"unsupported speaker status: {status}")
        segment.speaker = speaker.strip()
        segment.speaker_status = status
    elif name == "mark_overlap":
        segment.overlap = bool(operation.get("value", True))
    elif name == "mark_unclear":
        segment.unclear = bool(operation.get("value", True))
    after = asdict(segment)
    event = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "operation": operation,
        "segment_id": segment_id,
        "before": before,
        "after": after,
    }
    history = list(sidecar.get("correction_history", []))
    history.append(event)
    write_compiled(record, vault, correction_history=history)
    _, updated = load_sidecar(data_root, record_id)
    return {"record": updated["record"], "correction": event, "correction_history": updated["correction_history"]}
