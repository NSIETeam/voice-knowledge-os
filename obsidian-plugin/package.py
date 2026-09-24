from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent
PACKAGE_FILES = ("main.js", "loopback.js", "manifest.json", "styles.css", "versions.json")


def build(output: Path) -> Path:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    versions = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
    if versions.get(manifest.get("version")) != manifest.get("minAppVersion"):
        raise ValueError("versions.json must include the current plugin version and minAppVersion")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name in PACKAGE_FILES:
            source = ROOT / name
            if not source.is_file():
                raise FileNotFoundError(source)
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build a deterministic Voice Memory Obsidian plugin ZIP")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "voice-memory-obsidian-plugin.zip")
    args = parser.parse_args()
    print(build(args.output))
