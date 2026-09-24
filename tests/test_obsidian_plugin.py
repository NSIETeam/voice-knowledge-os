import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path


def test_obsidian_plugin_package_is_complete_and_reproducible(tmp_path):
    root = Path(__file__).resolve().parents[1]
    source = root / "obsidian-plugin"
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    versions = json.loads((source / "versions.json").read_text(encoding="utf-8"))
    assert versions[manifest["version"]] == manifest["minAppVersion"]

    archives = [tmp_path / f"plugin-{index}.zip" for index in range(2)]
    for archive in archives:
        subprocess.run(
            [sys.executable, str(source / "package.py"), "--output", str(archive)],
            check=True,
            capture_output=True,
            text=True,
        )
    digests = [hashlib.sha256(path.read_bytes()).hexdigest() for path in archives]
    assert digests[0] == digests[1]

    expected = {"main.js", "loopback.js", "manifest.json", "styles.css", "versions.json"}
    with zipfile.ZipFile(archives[0]) as archive:
        assert set(archive.namelist()) == expected
        for name in expected:
            assert archive.read(name) == (source / name).read_bytes()
