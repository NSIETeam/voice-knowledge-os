import json
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from voice_memory import api
from voice_memory.api import INDEX_HTML, VoiceMemoryHandler
from voice_memory.ledger import AudioLedger
from voice_memory.models import Segment
from voice_memory.transcription import Transcript


def test_local_dashboard_is_explicitly_loopback_oriented():
    assert "127.0.0.1" in INDEX_HTML
    assert "不会向局域网暴露录音" in INDEX_HTML


def test_compile_payload_shape_is_json_serializable():
    payload = {"record": {"id": "r1", "title": "demo", "created_at": "now", "audio_path": "a", "primary_mode": "decision", "segments": []}, "vault": "/tmp/vault"}
    assert json.loads(json.dumps(payload))["record"]["id"] == "r1"


def test_transcription_provider_payloads_are_explicit():
    fixture = {"provider": "fixture", "path": "/tmp/recording.webm"}
    whisper = {"provider": "whisper.cpp", "path": "/tmp/recording.webm", "executable": "/opt/whisper-cli", "model": "/models/ggml-base.bin"}
    assert json.loads(json.dumps(fixture))["provider"] == "fixture"
    assert json.loads(json.dumps(whisper))["model"].endswith("ggml-base.bin")


def test_uploaded_audio_can_be_transcribed_and_compiled_from_job(tmp_path, monkeypatch):
    class StubProvider:
        name = "fixture"

        def transcribe(self, _audio_path):
            return Transcript("fixture", "fixture-v1", "zh", [Segment("seg-1", 0, 1.2, "Unknown", "本地转写内容")])

    monkeypatch.setattr(api, "FixtureProvider", StubProvider)
    data_root = tmp_path / "data"
    ledger = AudioLedger(data_root)
    handler = type(
        "ConfiguredTestHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": ledger},
    )
    from voice_memory.jobs import JobStore
    handler.jobs = JobStore(data_root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        upload_request = urllib.request.Request(
            f"{base}/ledger/upload",
            data=b"fixture audio bytes",
            headers={"Content-Type": "application/octet-stream", "X-File-Name": "sample.webm"},
            method="POST",
        )
        with urllib.request.urlopen(upload_request) as response:
            assert response.status == 201
            asset = json.load(response)
        transcription_request = urllib.request.Request(
            f"{base}/transcribe",
            data=json.dumps({"asset_id": asset["id"], "provider": "fixture"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(transcription_request) as response:
            assert response.status == 202
            job = json.load(response)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = json.load(urllib.request.urlopen(f"{base}/jobs/{job['id']}"))
            if current["status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)
        assert current["status"] == "completed"

        compile_request = urllib.request.Request(
            f"{base}/records/from-job",
            data=json.dumps({
                "job_id": job["id"], "asset_id": asset["id"], "title": "本地测试记录",
                "primary_mode": "knowledge", "vault": str(tmp_path / "vault"),
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(compile_request) as response:
            assert response.status == 201
            compiled = json.load(response)
        markdown = Path(compiled["path"]).read_text(encoding="utf-8")
        assert "本地转写内容" in markdown
        record = json.load(urllib.request.urlopen(f"{base}/records/{compiled['record_id']}"))
        assert record["record"]["audio_asset_id"] == asset["id"]
        correction_request = urllib.request.Request(
            f"{base}/records/{compiled['record_id']}/corrections",
            data=json.dumps({"type":"edit_text", "segment_id":"seg-1", "text":"人工复核内容"}).encode(),
            headers={"Content-Type":"application/json"},
            method="POST",
        )
        correction = json.load(urllib.request.urlopen(correction_request))
        assert correction["record"]["segments"][0]["text"] == "人工复核内容"
        assert len(correction["correction_history"]) == 1
    finally:
        server.shutdown()
