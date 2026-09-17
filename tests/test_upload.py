import base64
import tempfile
from pathlib import Path

from voice_memory.ledger import AudioLedger


def test_loopback_upload_is_content_addressed():
    with tempfile.TemporaryDirectory() as directory:
        ledger = AudioLedger(Path(directory) / ".voice-memory")
        content = b"webm fixture"
        asset = ledger.import_bytes(content, "microphone.webm")
        assert asset.source_path == "loopback-upload"
        assert asset.size_bytes == len(base64.b64decode(base64.b64encode(content)))


def test_streamed_capture_sources_remain_separately_identifiable(tmp_path):
    from io import BytesIO

    ledger = AudioLedger(tmp_path / "data")
    content = b"shared sample bytes"
    microphone = ledger.import_stream(BytesIO(content), len(content), "mic.wav", source_path="microphone-capture")
    system = ledger.import_stream(BytesIO(content), len(content), "system.wav", source_path="system-audio-loopback")

    assert microphone.id != system.id
    assert microphone.stored_path == system.stored_path
    assert microphone.source_path == "microphone-capture"
    assert system.source_path == "system-audio-loopback"
