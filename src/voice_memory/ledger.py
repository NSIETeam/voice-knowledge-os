from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class AudioAsset:
    id: str
    sha256: str
    original_name: str
    source_path: str
    stored_path: str
    size_bytes: int
    imported_at: str
    sensitivity: str = "private"


class AudioLedger:
    """Content-addressed local audio ledger.

    The ledger keeps the imported bytes outside Markdown and records enough
    provenance to reproduce a processing run. Import is idempotent by SHA-256.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.objects = self.root / "objects"
        self.records = self.root / "ledger"
        self.objects.mkdir(parents=True, exist_ok=True)
        self.records.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def import_audio(self, source: str | Path, sensitivity: str = "private") -> AudioAsset:
        source_path = Path(source).expanduser().resolve()
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        sha256 = self._hash(source_path)
        object_path = self.objects / sha256
        if not object_path.exists():
            temporary = self.objects / f".{sha256}.part"
            try:
                shutil.copyfile(source_path, temporary)
                temporary.replace(object_path)
            finally:
                temporary.unlink(missing_ok=True)
        asset = AudioAsset(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"voice-memory:{sha256}")),
            sha256=sha256,
            original_name=source_path.name,
            source_path=str(source_path),
            stored_path=str(object_path),
            size_bytes=object_path.stat().st_size,
            imported_at=datetime.now(timezone.utc).isoformat(),
            sensitivity=sensitivity,
        )
        record_path = self.records / f"{asset.id}.json"
        if record_path.exists():
            return AudioAsset(**json.loads(record_path.read_text(encoding="utf-8")))
        record_path.write_text(json.dumps(asdict(asset), ensure_ascii=False, indent=2), encoding="utf-8")
        return asset

    def import_bytes(self, content: bytes, original_name: str, sensitivity: str = "private") -> AudioAsset:
        """Import bytes received from a loopback capture client without a temp path."""
        digest = hashlib.sha256(content).hexdigest()
        object_path = self.objects / digest
        if not object_path.exists():
            temporary = self.objects / f".{digest}.part"
            try:
                temporary.write_bytes(content)
                temporary.replace(object_path)
            finally:
                temporary.unlink(missing_ok=True)
        asset = AudioAsset(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"voice-memory:{digest}")),
            sha256=digest,
            original_name=original_name,
            source_path="loopback-upload",
            stored_path=str(object_path),
            size_bytes=len(content),
            imported_at=datetime.now(timezone.utc).isoformat(),
            sensitivity=sensitivity,
        )
        record_path = self.records / f"{asset.id}.json"
        if record_path.exists():
            return AudioAsset(**json.loads(record_path.read_text(encoding="utf-8")))
        record_path.write_text(json.dumps(asdict(asset), ensure_ascii=False, indent=2), encoding="utf-8")
        return asset

    def import_stream(
        self,
        stream,
        content_length: int,
        original_name: str,
        sensitivity: str = "private",
        source_path: str = "loopback-upload",
    ) -> AudioAsset:
        """Stream a loopback upload to disk without buffering the recording in memory."""
        if source_path not in {"loopback-upload", "file-import", "microphone-capture", "system-audio-loopback"}:
            raise ValueError("unsupported audio source")
        if content_length <= 0:
            raise ValueError("audio upload is empty")
        if content_length > 8 * 1024 * 1024 * 1024:
            raise ValueError("audio upload exceeds the 8 GiB limit")
        temporary = self.objects / f".upload-{uuid.uuid4().hex}.part"
        digest = hashlib.sha256()
        remaining = content_length
        try:
            with temporary.open("xb") as destination:
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("audio upload ended before Content-Length bytes were received")
                    destination.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
            sha256 = digest.hexdigest()
            object_path = self.objects / sha256
            if object_path.exists():
                temporary.unlink()
            else:
                temporary.replace(object_path)
        finally:
            temporary.unlink(missing_ok=True)
        asset_key = sha256 if source_path == "loopback-upload" else f"{sha256}:{source_path}"
        asset = AudioAsset(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"voice-memory:{asset_key}")),
            sha256=sha256,
            original_name=original_name,
            source_path=source_path,
            stored_path=str(object_path),
            size_bytes=content_length,
            imported_at=datetime.now(timezone.utc).isoformat(),
            sensitivity=sensitivity,
        )
        record_path = self.records / f"{asset.id}.json"
        if record_path.exists():
            return AudioAsset(**json.loads(record_path.read_text(encoding="utf-8")))
        record_path.write_text(json.dumps(asdict(asset), ensure_ascii=False, indent=2), encoding="utf-8")
        return asset

    def get(self, asset_id: str) -> AudioAsset:
        path = self.records / f"{asset_id}.json"
        if not path.is_file():
            raise KeyError(asset_id)
        return AudioAsset(**json.loads(path.read_text(encoding="utf-8")))
