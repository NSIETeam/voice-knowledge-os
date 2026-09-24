import json
import io
import struct
import tempfile
import wave
from pathlib import Path

from voice_memory.jobs import JobStore
from voice_memory.transcription import FixtureProvider


def _pcm16_mono_16khz_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(struct.pack("<hhhh", 0, 100, -100, 0))
    return buffer.getvalue()


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
    original = _pcm16_mono_16khz_wav()
    audio.write_bytes(original)
    output_paths = []

    def fake_run(command, **kwargs):
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
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

    def fake_run(command, **kwargs):
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
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


def test_wasapi_float_stereo_wav_is_normalized_before_whisper(tmp_path, monkeypatch):
    from voice_memory.transcription import WhisperCppProvider

    objects = tmp_path / "objects"
    objects.mkdir()
    audio = objects / "content-addressed-object"
    samples = struct.pack("<ffff", 0.0, 0.25, -0.25, 0.0)
    original = (
        b"RIFF" + struct.pack("<I", 36 + len(samples)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 3, 2, 48_000, 48_000 * 2 * 4, 2 * 4, 32)
        + b"data" + struct.pack("<I", len(samples)) + samples
    )
    audio.write_bytes(original)
    commands = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"normalized pcm16 wav")
        else:
            output_base = Path(command[command.index("-of") + 1])
            output_base.with_suffix(".json").write_text(json.dumps({"transcription": []}), encoding="utf-8")

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", fake_run)
    WhisperCppProvider("whisper-cli", "model.bin", source_name="system-audio.wav").transcribe(audio)

    assert commands[0][0] == "ffmpeg"
    assert commands[0][commands[0].index("-ar") + 1] == "16000"
    assert commands[0][commands[0].index("-ac") + 1] == "1"
    assert commands[0][commands[0].index("-c:a") + 1] == "pcm_s16le"
    assert commands[1][commands[1].index("-f") + 1].endswith("normalized.wav")
    assert audio.read_bytes() == original


def test_local_command_failures_are_actionable_and_keep_unicode_diagnostics(monkeypatch):
    import subprocess

    import pytest

    from voice_memory.transcription import _run_local_command

    def missing(_command, **_kwargs):
        raise FileNotFoundError

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", missing)
    with pytest.raises(RuntimeError, match="check its executable path"):
        _run_local_command(["whisper-cli.exe"], "whisper.cpp")

    def denied(_command, **_kwargs):
        raise PermissionError

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", denied)
    with pytest.raises(RuntimeError, match="check that the selected file is an executable"):
        _run_local_command(["whisper-cli.exe"], "whisper.cpp")

    def failed(command, **kwargs):
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
        raise subprocess.CalledProcessError(1, command, stderr="无法解码音频格式")

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", failed)
    with pytest.raises(RuntimeError, match="whisper.cpp failed with exit code 1: 无法解码音频格式"):
        _run_local_command(["whisper-cli.exe"], "whisper.cpp")


def test_nemo_diarization_adds_only_suggestions_and_detects_real_overlap(tmp_path, monkeypatch):
    from voice_memory.models import Segment
    from voice_memory.transcription import NemoSpeechDiarizationProvider, Transcript

    audio = tmp_path / "audio.wav"
    model = tmp_path / "sortformer.gguf"
    audio.write_bytes(b"audio")
    model.write_bytes(b"model placeholder")

    class BaseProvider:
        name = "fixture-asr"

        def transcribe(self, _audio_path):
            return Transcript("fixture-asr", "fixture-model", "en", [
                Segment("seg-1", 0.0, 1.0, "Unknown", "hello there"),
                Segment("seg-2", 1.0, 2.0, "Unknown", "goodbye"),
            ])

    def fake_run(command, **_kwargs):
        assert command[1] == "diarize"
        assert Path(command[2]).suffix == ".wav"
        assert command[command.index("--model") + 1] == str(model.resolve())
        Path(command[command.index("--output") + 1]).write_text(
            "SPEAKER audio 1 0.00 0.70 <NA> <NA> speaker_1 <NA> <NA>\n"
            "SPEAKER audio 1 0.50 0.40 <NA> <NA> speaker_2 <NA> <NA>\n"
            "SPEAKER audio 1 1.10 0.70 <NA> <NA> speaker_2 <NA> <NA>\n",
            encoding="utf-8",
        )

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", fake_run)
    result = NemoSpeechDiarizationProvider(BaseProvider(), "nemo-speech", str(model)).transcribe(audio)
    assert result.provider == "fixture-asr+nemo-speech.cpp"
    assert result.segments[0].speaker_ids == ["speaker_1", "speaker_2"]
    assert result.segments[0].speaker == "Speaker 1"
    assert result.segments[0].overlap is True
    assert result.segments[0].speaker_status == "suggestion"
    assert result.segments[1].speaker_ids == ["speaker_2"]
    assert result.segments[1].overlap is False


def test_nemo_diarization_requires_an_existing_local_model(tmp_path, monkeypatch):
    import pytest

    from voice_memory.transcription import NemoSpeechDiarizationProvider, Transcript

    class BaseProvider:
        name = "fixture-asr"

        def transcribe(self, _audio_path):
            return Transcript("fixture-asr", "model", None, [])

    def unexpected_run(*_args, **_kwargs):
        raise AssertionError("must not invoke a model downloader")

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", unexpected_run)
    with pytest.raises(RuntimeError, match="automatic model downloads are disabled"):
        NemoSpeechDiarizationProvider(BaseProvider(), "nemo-speech", str(tmp_path / "missing.gguf")).transcribe("audio.wav")


def test_nemo_diarization_normalizes_non_wav_to_temp_wav(tmp_path, monkeypatch):
    from voice_memory.models import Segment
    from voice_memory.transcription import NemoSpeechDiarizationProvider, Transcript

    audio = tmp_path / "audio.m4a"
    model = tmp_path / "sortformer.gguf"
    audio.write_bytes(b"compressed audio")
    model.write_bytes(b"model placeholder")

    class BaseProvider:
        name = "fixture-asr"

        def transcribe(self, _audio_path):
            return Transcript("fixture-asr", "fixture-model", "en", [Segment("seg-1", 0.0, 1.0, "Unknown", "hello")])

    commands = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"normalized wav")
        else:
            Path(command[command.index("--output") + 1]).write_text("", encoding="utf-8")

    monkeypatch.setattr("voice_memory.transcription.subprocess.run", fake_run)
    result = NemoSpeechDiarizationProvider(BaseProvider(), "nemo-speech", str(model), source_name="audio.m4a").transcribe(audio)
    assert commands[0][0] == "ffmpeg"
    assert commands[0][commands[0].index("-c:a") + 1] == "pcm_s16le"
    assert Path(commands[1][2]).suffix == ".wav"
    assert result.segments[0].speaker == "Unknown"
