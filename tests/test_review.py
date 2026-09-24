import json

from voice_memory.cli import demo_record
from voice_memory.compiler import write_compiled
from voice_memory.models import Segment
from voice_memory.review import apply_correction


def test_correction_is_replayed_and_preserves_history(tmp_path):
    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    result = apply_correction(vault / ".voice-memory", record.id, {
        "type": "edit_text",
        "segment_id": "seg-0001",
        "text": "修正后的决定内容",
    })
    assert result["record"]["segments"][0]["text"] == "修正后的决定内容"
    assert len(result["correction_history"]) == 1
    sidecar = json.loads((vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text(encoding="utf-8"))
    assert sidecar["correction_history"][0]["before"]["text"] != sidecar["correction_history"][0]["after"]["text"]
    transcript = json.loads((vault / ".voice-memory" / "transcripts" / f"{record.id}.json").read_text(encoding="utf-8"))
    assert transcript["schema_version"] == "voice-memory.transcript.v1"
    assert transcript["segments"][0]["text"] != "修正后的决定内容"
    markdown = (vault / "Recordings" / f"{record.title}.md").read_text(encoding="utf-8")
    assert "修正后的决定内容" in markdown


def test_split_merge_and_undo_redo_are_auditable(tmp_path):
    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    root = vault / ".voice-memory"
    original = json.loads((root / "recordings" / f"{record.id}.json").read_text(encoding="utf-8"))["record"]

    split = apply_correction(root, record.id, {
        "type": "split", "segment_id": "seg-0001", "split_at": 8.0,
        "left_text": "第一阶段先做桌面端", "right_text": "本地处理，手机端作为录音入口。",
    })
    split_record = split["record"]
    assert [item["id"] for item in split_record["segments"][:1]] == ["seg-0001"]
    assert split_record["segments"][0]["end"] == split_record["segments"][1]["start"] == 8.0
    split_id = split_record["segments"][1]["id"]
    assert split["can_undo"] is True and split["can_redo"] is False

    undone = apply_correction(root, record.id, {"type": "undo"})
    assert undone["record"] == original
    assert undone["can_redo"] is True

    redone = apply_correction(root, record.id, {"type": "redo"})
    assert [item["id"] for item in redone["record"]["segments"][:2]] == ["seg-0001", split_id]

    merged = apply_correction(root, record.id, {
        "type": "merge", "segment_ids": ["seg-0001", split_id], "separator": "",
    })
    assert len(merged["record"]["segments"]) == 2
    assert merged["record"]["segments"][0]["text"] == "第一阶段先做桌面端本地处理，手机端作为录音入口。"
    assert merged["record"]["segments"][0]["end"] == 18.4
    assert len(merged["correction_history"]) == 4

    undone_merge = apply_correction(root, record.id, {"type": "undo"})
    assert [item["id"] for item in undone_merge["record"]["segments"][:2]] == ["seg-0001", split_id]


def test_split_and_merge_reject_invalid_timing_or_non_adjacent_segments(tmp_path):
    import pytest

    vault = tmp_path / "vault"
    record = demo_record()
    record.segments.append(Segment("seg-0003", 31.2, 40.0, "Speaker 1", "第三段。"))
    write_compiled(record, vault)
    root = vault / ".voice-memory"

    with pytest.raises(ValueError, match="fall inside"):
        apply_correction(root, record.id, {
            "type": "split", "segment_id": "seg-0001", "split_at": 18.4,
            "left_text": "左", "right_text": "右",
        })
    with pytest.raises(ValueError, match="adjacent"):
        apply_correction(root, record.id, {
            "type": "merge", "segment_ids": ["seg-0001", "seg-0003"],
        })
    with pytest.raises(ValueError, match="no review changes"):
        apply_correction(root, record.id, {"type": "undo"})


def test_timing_edit_is_validated_and_undoable(tmp_path):
    import pytest

    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    root = vault / ".voice-memory"

    changed = apply_correction(root, record.id, {
        "type": "edit_timing", "segment_id": "seg-0001", "start": 0.5, "end": 17.0,
    })
    assert (changed["record"]["segments"][0]["start"], changed["record"]["segments"][0]["end"]) == (0.5, 17.0)
    restored = apply_correction(root, record.id, {"type": "undo"})
    assert (restored["record"]["segments"][0]["start"], restored["record"]["segments"][0]["end"]) == (0, 18.4)

    with pytest.raises(ValueError, match="overlaps the following"):
        apply_correction(root, record.id, {
            "type": "edit_timing", "segment_id": "seg-0001", "start": 0, "end": 20,
        })


def test_new_change_after_undo_starts_a_history_branch(tmp_path):
    import pytest

    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    root = vault / ".voice-memory"
    apply_correction(root, record.id, {"type": "edit_text", "segment_id": "seg-0001", "text": "第一版"})
    apply_correction(root, record.id, {"type": "undo"})
    changed = apply_correction(root, record.id, {"type": "edit_text", "segment_id": "seg-0001", "text": "新的分支"})
    assert changed["record"]["segments"][0]["text"] == "新的分支"
    assert changed["can_redo"] is False
    with pytest.raises(ValueError, match="no review changes to redo"):
        apply_correction(root, record.id, {"type": "redo"})


def test_boolean_flags_reject_string_values(tmp_path):
    import pytest

    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    root = vault / ".voice-memory"

    with pytest.raises(ValueError, match="must be a boolean"):
        apply_correction(root, record.id, {
            "type": "mark_overlap", "segment_id": "seg-0001", "value": "false",
        })


def test_source_transcript_snapshot_is_immutable_across_recompile(tmp_path):
    vault = tmp_path / "vault"
    record = demo_record()
    write_compiled(record, vault)
    path = vault / ".voice-memory" / "transcripts" / f"{record.id}.json"
    original = path.read_bytes()
    record.segments[0].text = "later corrected value"
    write_compiled(record, vault)
    assert path.read_bytes() == original


def test_audio_asset_id_is_preserved_in_sidecar(tmp_path):
    vault = tmp_path / "vault"
    record = demo_record()
    record.audio_asset_id = "asset-123"
    write_compiled(record, vault)
    sidecar = json.loads((vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text(encoding="utf-8"))
    assert sidecar["record"]["audio_asset_id"] == "asset-123"


def test_audio_content_supports_range_requests(tmp_path):
    import threading
    import urllib.request
    from http.server import ThreadingHTTPServer

    from voice_memory.api import VoiceMemoryHandler
    from voice_memory.ledger import AudioLedger

    ledger = AudioLedger(tmp_path / "data")
    asset = ledger.import_bytes(b"0123456789", "sample.webm")
    handler = type("TestHandler", (VoiceMemoryHandler,), {"data_root": tmp_path / "data", "ledger": ledger, "jobs": None})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/ledger/{asset.id}/content",
            headers={"Range": "bytes=3-6"},
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 206
            assert response.headers["Content-Range"] == "bytes 3-6/10"
            assert response.read() == b"3456"
    finally:
        server.shutdown()
