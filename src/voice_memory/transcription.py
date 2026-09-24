from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from .models import Segment


@dataclass(frozen=True)
class Transcript:
    provider: str
    model: str
    language: str | None
    segments: list[Segment]

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "language": self.language,
            "segments": [asdict(segment) for segment in self.segments],
        }


class TranscriptionProvider(Protocol):
    name: str

    def transcribe(self, audio_path: str | Path) -> Transcript:
        ...


def _wav_needs_whisper_normalization(audio_path: Path) -> bool:
    try:
        with wave.open(str(audio_path), "rb") as source:
            return not (
                source.getcomptype() == "NONE"
                and source.getsampwidth() == 2
                and source.getnchannels() == 1
                and source.getframerate() == 16_000
            )
    except (wave.Error, EOFError, OSError):
        # whisper.cpp's CLI accepts 16-bit WAV; float and malformed WAVs must
        # be converted locally before they reach that parser.
        return True


def _run_local_command(command: list[str], label: str, missing_message: str | None = None) -> None:
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        raise RuntimeError(missing_message or f"{label} was not found; check its executable path in settings") from None
    except PermissionError:
        raise RuntimeError(f"{label} could not be started; check that the selected file is an executable program") from None
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or "").strip()
        if len(detail) > 1600:
            detail = "…" + detail[-1600:]
        message = f"{label} failed with exit code {error.returncode}"
        if detail:
            message += f": {detail}"
        raise RuntimeError(message) from None


class FixtureProvider:
    """Offline provider used for deterministic replay and acceptance tests."""

    name = "fixture"

    def transcribe(self, audio_path: str | Path) -> Transcript:
        audio = Path(audio_path)
        fixture = audio.with_suffix(audio.suffix + ".transcript.json")
        if not fixture.is_file():
            raise FileNotFoundError(f"fixture transcript not found: {fixture}")
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        return Transcript(
            provider=self.name,
            model=payload.get("model", "fixture-v1"),
            language=payload.get("language"),
            segments=[Segment(**segment) for segment in payload.get("segments", [])],
        )


class WhisperCppProvider:
    """Safe subprocess adapter for a locally installed whisper.cpp binary."""

    name = "whisper.cpp"

    def __init__(
        self,
        executable: str | Path,
        model: str | Path,
        ffmpeg_executable: str | Path = "ffmpeg",
        source_name: str | None = None,
    ):
        self.executable = str(executable)
        self.model = str(model)
        self.ffmpeg_executable = str(ffmpeg_executable)
        self.source_name = source_name

    def transcribe(self, audio_path: str | Path) -> Transcript:
        audio = Path(audio_path)
        with tempfile.TemporaryDirectory(prefix="voice-memory-whisper-") as temporary_dir:
            working_dir = Path(temporary_dir)
            original_suffix = Path(self.source_name or audio.name).suffix.lower()
            safe_suffix = original_suffix if original_suffix and original_suffix[1:].isalnum() else ""
            named_input = working_dir / f"source{safe_suffix}"
            if audio.suffix.lower() == safe_suffix and safe_suffix:
                named_input = audio
            else:
                try:
                    os.link(audio, named_input)
                except OSError:
                    shutil.copyfile(audio, named_input)
            whisper_input = named_input
            if safe_suffix not in {".wav", ".mp3", ".flac", ".ogg"} or (
                safe_suffix == ".wav" and _wav_needs_whisper_normalization(named_input)
            ):
                if not self.ffmpeg_executable:
                    raise RuntimeError("This audio format needs FFmpeg; choose ffmpeg or convert the file to WAV, MP3, FLAC, or OGG")
                normalized = working_dir / "normalized.wav"
                _run_local_command(
                    [self.ffmpeg_executable, "-nostdin", "-y", "-i", str(named_input), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(normalized)],
                    "FFmpeg",
                    "FFmpeg is required for this audio format but was not found; select ffmpeg.exe in settings",
                )
                whisper_input = normalized
            output_base = working_dir / "transcript"
            output = output_base.with_suffix(".json")
            command = [self.executable, "-m", self.model, "-f", str(whisper_input), "-oj", "-of", str(output_base)]
            _run_local_command(command, "whisper.cpp")
            payload = json.loads(output.read_text(encoding="utf-8"))
        segments = [
            Segment(
                id=f"seg-{index:04d}",
                start=float(item.get("t0", 0)) / 100.0,
                end=float(item.get("t1", 0)) / 100.0,
                speaker="Unknown",
                text=item.get("text", "").strip(),
                confidence=None,
            )
            for index, item in enumerate(payload.get("transcription", []), 1)
        ]
        return Transcript(provider=self.name, model=self.model, language=None, segments=segments)


@dataclass(frozen=True)
class _SpeakerInterval:
    start: float
    end: float
    speaker_id: str


class NemoSpeechDiarizationProvider:
    """Add local NeMo-Speech.cpp speaker suggestions to an existing transcript."""

    name = "nemo-speech.cpp"

    def __init__(
        self,
        base: TranscriptionProvider,
        executable: str | Path,
        model: str | None = None,
        ffmpeg_executable: str | Path = "ffmpeg",
        source_name: str | None = None,
    ):
        self.base = base
        self.executable = str(executable)
        self.model = model.strip() if isinstance(model, str) and model.strip() else None
        self.ffmpeg_executable = str(ffmpeg_executable)
        self.source_name = source_name

    @staticmethod
    def _read_rttm(path: Path) -> list[_SpeakerInterval]:
        intervals = []
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            fields = line.split()
            if not fields:
                continue
            if len(fields) != 10 or fields[0] != "SPEAKER":
                raise ValueError(f"NeMo diarization returned invalid RTTM at line {line_number}")
            try:
                start, duration = float(fields[3]), float(fields[4])
            except ValueError:
                raise ValueError(f"NeMo diarization returned invalid timing at line {line_number}") from None
            if not (math.isfinite(start) and math.isfinite(duration) and start >= 0 and duration > 0):
                raise ValueError(f"NeMo diarization returned invalid timing at line {line_number}")
            speaker = fields[7]
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", speaker):
                raise ValueError(f"NeMo diarization returned invalid speaker ID at line {line_number}")
            intervals.append(_SpeakerInterval(start, start + duration, speaker))
        return intervals

    def transcribe(self, audio_path: str | Path) -> Transcript:
        if not self.model or not Path(self.model).expanduser().is_file():
            raise RuntimeError("select an existing local NeMo diarization model file; automatic model downloads are disabled")
        transcript = self.base.transcribe(audio_path)
        with tempfile.TemporaryDirectory(prefix="voice-memory-nemo-diarization-") as temporary_dir:
            temporary = Path(temporary_dir)
            output = temporary / "speakers.rttm"
            source = Path(audio_path).resolve()
            suffix = Path(self.source_name or source.name).suffix.lower()
            if suffix == ".wav":
                diarization_audio = temporary / "recording.wav"
                try:
                    os.link(source, diarization_audio)
                except OSError:
                    shutil.copyfile(source, diarization_audio)
            else:
                diarization_audio = temporary / "recording.wav"
                _run_local_command(
                    [self.ffmpeg_executable, "-nostdin", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(diarization_audio)],
                    "FFmpeg",
                    "FFmpeg is required to prepare this recording for local diarization; select ffmpeg.exe in settings",
                )
            command = [self.executable, "diarize", str(diarization_audio), "--model", str(Path(self.model).expanduser().resolve()), "--format", "rttm", "--output", str(output)]
            _run_local_command(
                command,
                "NeMo-Speech.cpp diarization",
                "NeMo-Speech.cpp was not found; install it locally or clear the diarization executable setting",
            )
            intervals = self._read_rttm(output)

        # Sortformer IDs identify acoustic clusters within this recording only.
        # They are suggestions, never persistent person identities.
        for segment in transcript.segments:
            touched = [item for item in intervals if item.start < segment.end and item.end > segment.start]
            if not touched:
                continue
            overlap_durations: dict[str, float] = {}
            for item in touched:
                overlap_durations[item.speaker_id] = overlap_durations.get(item.speaker_id, 0.0) + max(
                    0.0, min(segment.end, item.end) - max(segment.start, item.start)
                )
            dominant = max(overlap_durations, key=overlap_durations.get)
            simultaneous = set()
            for index, left in enumerate(touched):
                for right in touched[index + 1:]:
                    if left.speaker_id != right.speaker_id and min(left.end, right.end, segment.end) - max(left.start, right.start, segment.start) > 0.05:
                        simultaneous.update((left.speaker_id, right.speaker_id))
            labels = sorted(simultaneous) if len(simultaneous) > 1 else [dominant]
            segment.speaker_ids = labels
            display_id = re.sub(r"^speaker[_-]?", "", labels[0], flags=re.IGNORECASE)
            segment.speaker = f"Speaker {display_id}"
            segment.speaker_status = "suggestion"
            segment.overlap = segment.overlap or len(labels) > 1
            segment.source = "transcript+diarization"
        return Transcript(
            provider=f"{transcript.provider}+{self.name}",
            model=f"{transcript.model}; diarization={self.model or 'default'}",
            language=transcript.language,
            segments=transcript.segments,
        )
