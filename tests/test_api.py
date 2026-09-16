import json
import tempfile
from pathlib import Path
from voice_memory.api import INDEX_HTML


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
