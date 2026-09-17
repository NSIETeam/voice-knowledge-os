from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
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
            if safe_suffix not in {".wav", ".mp3", ".flac", ".ogg"}:
                if not self.ffmpeg_executable:
                    raise RuntimeError("This audio format needs FFmpeg; choose ffmpeg or convert the file to WAV, MP3, FLAC, or OGG")
                normalized = working_dir / "normalized.wav"
                try:
                    subprocess.run(
                        [self.ffmpeg_executable, "-nostdin", "-y", "-i", str(named_input), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(normalized)],
                        check=True,
                        capture_output=True,
                        text=True,
                    )
                except FileNotFoundError as error:
                    raise RuntimeError("FFmpeg is required for this audio format but was not found") from error
                whisper_input = normalized
            output_base = working_dir / "transcript"
            output = output_base.with_suffix(".json")
            command = [self.executable, "-m", self.model, "-f", str(whisper_input), "-oj", "-of", str(output_base)]
            subprocess.run(command, check=True, capture_output=True, text=True)
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
