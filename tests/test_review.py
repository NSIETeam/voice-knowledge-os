import json

from voice_memory.cli import demo_record
from voice_memory.compiler import write_compiled
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
    sidecar = json.loads((vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text())
    assert sidecar["correction_history"][0]["before"]["text"] != sidecar["correction_history"][0]["after"]["text"]
    markdown = (vault / "Recordings" / f"{record.title}.md").read_text()
    assert "修正后的决定内容" in markdown


def test_audio_asset_id_is_preserved_in_sidecar(tmp_path):
    vault = tmp_path / "vault"
    record = demo_record()
    record.audio_asset_id = "asset-123"
    write_compiled(record, vault)
    sidecar = json.loads((vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text())
    assert sidecar["record"]["audio_asset_id"] == "asset-123"
