from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from .transcription import Transcript, TranscriptionProvider


@dataclass
class ProcessingJob:
    id: str
    source_path: str
    provider: str
    status: str
    created_at: str
    transcript_path: str | None = None
    error: str | None = None


class JobStore:
    def __init__(self, root: str | Path):
        self.root = Path(root) / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, job_id: str) -> Path:
        return self.root / f"{job_id}.json"

    def get(self, job_id: str) -> ProcessingJob:
        with self._lock:
            return ProcessingJob(**json.loads(self._path(job_id).read_text(encoding="utf-8")))

    def _save(self, job: ProcessingJob) -> None:
        path = self._path(job.id)
        temporary = path.with_suffix(".tmp")
        with self._lock:
            temporary.write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(path)

    def submit(self, source_path: str | Path, provider: TranscriptionProvider) -> ProcessingJob:
        job = ProcessingJob(
            id=str(uuid.uuid4()),
            source_path=str(Path(source_path).expanduser().resolve()),
            provider=provider.name,
            status="queued",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._save(job)
        worker = threading.Thread(target=self._run, args=(job, provider), daemon=True, name=f"voice-memory-job-{job.id[:8]}")
        worker.start()
        return job

    def _run(self, job: ProcessingJob, provider: TranscriptionProvider) -> None:
        job.status = "running"
        self._save(job)
        try:
            transcript: Transcript = provider.transcribe(job.source_path)
            transcript_path = self.root / f"{job.id}.transcript.json"
            temporary = transcript_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(transcript.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(transcript_path)
            job.status = "completed"
            job.transcript_path = str(transcript_path)
        except Exception as error:  # persist failure for retryable UI state
            job.status = "failed"
            job.error = str(error)
        self._save(job)

    def transcribe(self, source_path: str | Path, provider: TranscriptionProvider) -> ProcessingJob:
        job = ProcessingJob(
            id=str(uuid.uuid4()),
            source_path=str(Path(source_path).expanduser().resolve()),
            provider=provider.name,
            status="running",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._save(job)
        self._run(job, provider)
        return job
