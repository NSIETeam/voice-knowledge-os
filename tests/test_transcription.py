import json
import tempfile
from pathlib import Path

from voice_memory.jobs import JobStore
from voice_memory.transcription import FixtureProvider


def test_fixture_transcription_is_replayable_and_persisted():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        audio = root / "demo.m4a"
        audio.write_bytes(b"fixture audio")
        (root / "demo.m4a.transcript.json").write_text(json.dumps({
            "language": "zh",
            "segments": [{"id": "seg-1", "start": 0, "end": 1.2, "speaker": "Speaker 1", "text": "你好"}],
        }), encoding="utf-8")
        job = JobStore(root / ".voice-memory").transcribe(audio, FixtureProvider())
        assert job.status == "completed"
        assert json.loads(Path(job.transcript_path).read_text(encoding="utf-8"))["segments"][0]["text"] == "你好"


def test_missing_provider_input_is_a_persisted_failure():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        audio = root / "missing.m4a"
        audio.write_bytes(b"fixture audio")
        job = JobStore(root / ".voice-memory").transcribe(audio, FixtureProvider())
        assert job.status == "failed"
        assert "fixture transcript not found" in job.error

