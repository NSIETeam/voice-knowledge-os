from __future__ import annotations

import json
import subprocess
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

    def __init__(self, executable: str | Path, model: str | Path):
        self.executable = str(executable)
        self.model = str(model)

    def transcribe(self, audio_path: str | Path) -> Transcript:
        audio = Path(audio_path)
        output = audio.with_suffix(audio.suffix + ".whisper.json")
        command = [self.executable, "-m", self.model, "-f", str(audio), "-oj", "-of", str(output.with_suffix(""))]
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

