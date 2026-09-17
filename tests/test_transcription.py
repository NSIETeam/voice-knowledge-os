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


def test_whisper_outputs_are_kept_out_of_immutable_audio_directory(tmp_path, monkeypatch):
    from voice_memory.transcription import WhisperCppProvider

    objects = tmp_path / "objects"
    objects.mkdir()
    audio = objects / "content-addressed-object"
    original = b"immutable source bytes"
    audio.write_bytes(original)
    output_paths = []

    def fake_run(command, **_kwargs):
        output_base = Path(command[command.index("-of") + 1])
        output_paths.append(output_base)
        output_base.with_suffix(".json").write_text(
            json.dumps({"transcription": [{"t0": 0, "t1": 123, "text": " local text "}]}),
            encoding="utf-8",
        )

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", fake_run)
    result = WhisperCppProvider("whisper-cli", "model.bin", source_name="content.wav").transcribe(audio)

    assert result.segments[0].text == "local text"
    assert output_paths[0].parent != objects
    assert not output_paths[0].parent.exists()
    assert audio.read_bytes() == original
    assert list(objects.iterdir()) == [audio]


def test_web_audio_is_normalized_with_ffmpeg_in_temporary_workspace(tmp_path, monkeypatch):
    from voice_memory.transcription import WhisperCppProvider

    objects = tmp_path / "objects"
    objects.mkdir()
    audio = objects / "content-addressed-object"
    original = b"webm source bytes"
    audio.write_bytes(original)
    commands = []
    working_directories = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        if command[0] == "ffmpeg":
            working_directories.append(Path(command[-1]).parent)
            Path(command[-1]).write_bytes(b"normalized wav")
        else:
            output_base = Path(command[command.index("-of") + 1])
            output_base.with_suffix(".json").write_text(json.dumps({"transcription": []}), encoding="utf-8")

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", fake_run)
    WhisperCppProvider("whisper-cli", "model.bin", source_name="recording.webm").transcribe(audio)

    assert commands[0][:8] == ["ffmpeg", "-nostdin", "-y", "-i", commands[0][4], "-vn", "-ac", "1"]
    assert commands[1][commands[1].index("-f") + 1].endswith("normalized.wav")
    assert not working_directories[0].exists()
    assert audio.read_bytes() == original
