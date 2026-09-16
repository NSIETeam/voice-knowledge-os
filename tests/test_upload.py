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

