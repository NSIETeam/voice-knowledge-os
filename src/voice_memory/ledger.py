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

    def get(self, asset_id: str) -> AudioAsset:
        path = self.records / f"{asset_id}.json"
        if not path.is_file():
            raise KeyError(asset_id)
        return AudioAsset(**json.loads(path.read_text(encoding="utf-8")))

