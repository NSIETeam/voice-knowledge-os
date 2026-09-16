from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main() -> None:
    target_root = Path(sys.argv[1])
    bundle_dirs = sorted(path for path in target_root.rglob("bundle") if path.is_dir())
    if not bundle_dirs:
        raise SystemExit("no Tauri bundle directories found")
    for bundle_dir in bundle_dirs:
        files = sorted(path for path in bundle_dir.rglob("*") if path.is_file() and path.name != "SHA256SUMS.txt")
        manifest = "".join(f"{digest(path)}  {path.relative_to(bundle_dir).as_posix()}\n" for path in files)
        (bundle_dir / "SHA256SUMS.txt").write_text(manifest, encoding="utf-8")


if __name__ == "__main__":
    main()
