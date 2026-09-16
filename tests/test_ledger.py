import tempfile
from pathlib import Path

from voice_memory.ledger import AudioLedger


def test_import_is_content_addressed_and_idempotent():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "sample.m4a"
        source.write_bytes(b"immutable audio fixture")
        ledger = AudioLedger(root / ".voice-memory")
        first = ledger.import_audio(source)
        second = ledger.import_audio(source)
        assert first.id == second.id
        assert first.sha256 == second.sha256
        assert Path(first.stored_path).read_bytes() == source.read_bytes()

