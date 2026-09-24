from __future__ import annotations

import json
import math
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .compiler import write_compiled, write_source_transcript_snapshot
from .models import ConversationRecord, Segment


VALID_OPERATIONS = {
    "edit_text", "edit_timing", "relabel", "set_speakers", "mark_overlap", "mark_unclear",
    "split", "merge", "undo", "redo",
}
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


def _segment_snapshot(record: ConversationRecord) -> list[dict[str, Any]]:
    return [asdict(segment) for segment in record.segments]


def _restore_segments(record: ConversationRecord, value: list[dict[str, Any]]) -> None:
    record.segments = [Segment(**segment) for segment in value]


def _segment(record: ConversationRecord, segment_id: Any) -> Segment:
    segment = next((item for item in record.segments if item.id == segment_id), None)
    if segment is None:
        raise ValueError(f"segment not found: {segment_id}")
    return segment


def _apply_change(
    record: ConversationRecord,
    operation: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | list[dict[str, Any]], dict[str, Any] | None]:
    name = operation.get("type")
    segment_id = operation.get("segment_id")
    if name == "split":
        original = _segment(record, segment_id)
        split_at = operation.get("split_at")
        left_text = operation.get("left_text")
        right_text = operation.get("right_text")
        if isinstance(split_at, bool) or not isinstance(split_at, (int, float)) or not math.isfinite(split_at):
            raise ValueError("split_at must be a finite audio timestamp")
        if not original.start < split_at < original.end:
            raise ValueError("split_at must fall inside the selected segment")
        if not isinstance(left_text, str) or not left_text.strip() or not isinstance(right_text, str) or not right_text.strip():
            raise ValueError("splitting requires non-empty text on both sides")
        before = asdict(original)
        new_id = f"seg-{uuid.uuid4().hex[:12]}"
        while any(item.id == new_id for item in record.segments):
            new_id = f"seg-{uuid.uuid4().hex[:12]}"
        first = Segment(**before)
        second = Segment(**before)
        first.end = float(split_at)
        first.text = left_text.strip()
        second.id = new_id
        second.start = float(split_at)
        second.text = right_text.strip()
        index = record.segments.index(original)
        record.segments[index:index + 1] = [first, second]
        return segment_id, before, None

    if name == "merge":
        ids = operation.get("segment_ids")
        if not isinstance(ids, list) or len(ids) != 2 or ids[0] == ids[1]:
            raise ValueError("merge requires exactly two different segment IDs")
        first = _segment(record, ids[0])
        second = _segment(record, ids[1])
        first_index = record.segments.index(first)
        second_index = record.segments.index(second)
        if second_index != first_index + 1:
            raise ValueError("only adjacent transcript segments can be merged")
        if first.speaker != second.speaker:
            raise ValueError("segments with different speakers cannot be merged")
        if first.overlap or second.overlap:
            raise ValueError("overlapping segments cannot be merged")
        before = [asdict(first), asdict(second)]
        separator = operation.get("separator", "")
        if not isinstance(separator, str) or len(separator) > 8:
            raise ValueError("merge separator must be a short string")
        first.end = second.end
        first.text = f"{first.text.rstrip()}{separator}{second.text.lstrip()}"
        first.unclear = first.unclear or second.unclear
        first.overlap = False
        first.speaker_status = first.speaker_status if first.speaker_status == second.speaker_status else "unknown"
        confidences = [item for item in (first.confidence, second.confidence) if item is not None]
        first.confidence = min(confidences) if confidences else None
        record.segments.remove(second)
        return ids[0], before, None

    original = _segment(record, segment_id)
    before = asdict(original)
    if name == "edit_text":
        text = operation.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must be a non-empty string")
        original.text = text.strip()
    elif name == "edit_timing":
        start, end = operation.get("start"), operation.get("end")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (start, end)):
            raise ValueError("segment start and end must be finite timestamps")
        if start < 0 or start >= end:
            raise ValueError("segment timing must satisfy 0 <= start < end")
        index = record.segments.index(original)
        if index and start < record.segments[index - 1].end:
            raise ValueError("segment start overlaps the preceding segment; mark overlap before changing timing")
        if index + 1 < len(record.segments) and end > record.segments[index + 1].start:
            raise ValueError("segment end overlaps the following segment; mark overlap before changing timing")
        original.start, original.end = float(start), float(end)
    elif name == "relabel":
        speaker = operation.get("speaker")
        status = operation.get("speaker_status", "confirmed")
        if not isinstance(speaker, str) or not speaker.strip():
            raise ValueError("speaker must be a non-empty string")
        if status not in VALID_SPEAKER_STATUS:
            raise ValueError(f"unsupported speaker status: {status}")
        original.speaker = speaker.strip()
        original.speaker_status = status
        original.speaker_ids = [speaker.strip()]
    elif name == "set_speakers":
        speakers = operation.get("speaker_ids")
        if not isinstance(speakers, list) or len(speakers) > 8:
            raise ValueError("speaker_ids must be a list containing at most eight speaker IDs")
        normalized = []
        for value in speakers:
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 64:
                raise ValueError("speaker IDs must be non-empty strings of at most 64 characters")
            value = value.strip()
            if value not in normalized:
                normalized.append(value)
        original.speaker_ids = normalized
        original.speaker = normalized[0] if normalized else "Unknown"
        if len(normalized) > 1:
            original.overlap = True
        elif not normalized:
            original.speaker_status = "unknown"
    elif name == "mark_overlap":
        value = operation.get("value", True)
        if not isinstance(value, bool):
            raise ValueError("overlap value must be a boolean")
        if not value and len(original.speaker_ids) > 1:
            raise ValueError("a segment assigned to multiple speakers must remain marked as overlapping")
        original.overlap = value
    elif name == "mark_unclear":
        value = operation.get("value", True)
        if not isinstance(value, bool):
            raise ValueError("unclear value must be a boolean")
        original.unclear = value
    else:
        raise ValueError(f"unsupported correction: {name}")
    return segment_id, before, asdict(original)


def _legacy_restore(record: ConversationRecord, event: dict[str, Any], key: str) -> None:
    target = event.get(key)
    if isinstance(target, list):
        # Legacy multi-segment events are not produced, but rejecting them is safer
        # than guessing the correct insertion point after later edits.
        raise ValueError("legacy correction cannot be safely replayed")
    segment_id = event.get("segment_id")
    index = next((i for i, item in enumerate(record.segments) if item.id == segment_id), None)
    if index is None or not isinstance(target, dict):
        raise ValueError("legacy correction no longer matches the current transcript")
    record.segments[index] = Segment(**target)


def _undo(record: ConversationRecord, history: list[dict[str, Any]]) -> dict[str, Any]:
    target = next(
        (event for event in reversed(history)
         if event.get("kind", "change") == "change" and event.get("active", True)),
        None,
    )
    if target is None:
        raise ValueError("there are no review changes to undo")
    before_segments = _segment_snapshot(record)
    if isinstance(target.get("before_segments"), list):
        _restore_segments(record, target["before_segments"])
    else:
        _legacy_restore(record, target, "before")
    target["active"] = False
    event_id = str(uuid.uuid4())
    event = {
        "id": event_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "kind": "undo",
        "operation": {"type": "undo", "target_event_id": target["id"]},
        "target_event_id": target["id"],
        "before_segments": before_segments,
        "after_segments": _segment_snapshot(record),
        "redone": False,
        "abandoned": False,
    }
    target["undone_by"] = event_id
    history.append(event)
    return event


def _redo(record: ConversationRecord, history: list[dict[str, Any]]) -> dict[str, Any]:
    undo_event = next(
        (event for event in reversed(history)
         if event.get("kind") == "undo" and not event.get("redone") and not event.get("abandoned")),
        None,
    )
    if undo_event is None:
        raise ValueError("there are no review changes to redo")
    target = next((event for event in history if event.get("id") == undo_event.get("target_event_id")), None)
    if target is None:
        raise ValueError("the change selected for redo is missing from history")
    before_segments = _segment_snapshot(record)
    if isinstance(target.get("after_segments"), list):
        _restore_segments(record, target["after_segments"])
    else:
        _legacy_restore(record, target, "after")
    target["active"] = True
    undo_event["redone"] = True
    event = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "kind": "redo",
        "operation": {"type": "redo", "target_event_id": target["id"]},
        "target_event_id": target["id"],
        "before_segments": before_segments,
        "after_segments": _segment_snapshot(record),
    }
    history.append(event)
    return event


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
    history = list(sidecar.get("correction_history", []))
    before_segments = _segment_snapshot(record)
    segment_id = operation.get("segment_id")

    if name == "undo":
        event = _undo(record, history)
    elif name == "redo":
        event = _redo(record, history)
    else:
        # A new accepted change starts a new history branch and invalidates redo.
        for item in history:
            if item.get("kind") == "undo" and not item.get("redone"):
                item["abandoned"] = True
        segment_id, before, after = _apply_change(record, operation)
        event = {
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "kind": "change",
            "operation": operation,
            "segment_id": segment_id,
            "before": before,
            "after": after,
            "before_segments": before_segments,
            "after_segments": _segment_snapshot(record),
            "active": True,
        }
        history.append(event)

    write_compiled(record, vault, correction_history=history)
    _, updated = load_sidecar(data_root, record_id)
    updated_history = updated["correction_history"]
    return {
        "record": updated["record"],
        "correction": event,
        "correction_history": updated_history,
        "can_undo": any(item.get("kind", "change") == "change" and item.get("active", True) for item in updated_history),
        "can_redo": any(item.get("kind") == "undo" and not item.get("redone") and not item.get("abandoned") for item in updated_history),
    }
