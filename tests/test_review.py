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
    sidecar = json.loads((vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text(encoding="utf-8"))
    assert sidecar["correction_history"][0]["before"]["text"] != sidecar["correction_history"][0]["after"]["text"]
    transcript = json.loads((vault / ".voice-memory" / "transcripts" / f"{record.id}.json").read_text(encoding="utf-8"))
    assert transcript["schema_version"] == "voice-memory.transcript.v1"
    assert transcript["segments"][0]["text"] != "修正后的决定内容"
    markdown = (vault / "Recordings" / f"{record.title}.md").read_text(encoding="utf-8")
    assert "修正后的决定内容" in markdown


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
