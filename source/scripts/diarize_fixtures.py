"""Public test-audio fixture preparation; not part of the shipped app.
Only explicit callers download these pinned, licensed, small WAV files.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import wave


def prepare_aishell3(root, source="mirror", fixture="aishell3"):
    assert fixture in ("aishell3", "aishell3-long")
    manifest_path = Path(__file__).parent / "fixtures" / f"{fixture}-smoke.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest["dataset"] == "AISHELL/AISHELL-3"
    assert re.fullmatch(r"[a-f0-9]{40}", manifest["revision"])
    assert source in ("mirror", "official")
    split = manifest.get("split", "test")
    assert split in ("train", "test")
    registry = "https://hf-mirror.com" if source == "mirror" else "https://huggingface.co"
    jobs = []
    for speaker in manifest["speakers"]:
        assert re.fullmatch(r"SSB[0-9]{4}", speaker["id"])
        assert len(speaker["files"]) in (2, 6)
        for entry in speaker["files"]:
            assert re.fullmatch(re.escape(speaker["id"]) + r"[0-9]{4}\.wav", entry["name"])
            assert re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
            assert 0 < entry["bytes"] < 1_000_000
            jobs.append((speaker["id"], entry))
    assert len(manifest["speakers"]) == 2 and len({s["id"] for s in manifest["speakers"]}) == 2
    assert len({entry["name"] for _, entry in jobs}) == len(jobs)
    fetcher = root / "fetch-public-fixture"
    subprocess.run(["/usr/bin/swiftc", str(Path(__file__).parent / "fetch-public-fixture.swift"), "-o", str(fetcher)], check=True, timeout=60)

    def download(job):
        speaker, entry = job
        raw = root / entry["name"]
        url = f"{registry}/datasets/{manifest['dataset']}/resolve/{manifest['revision']}/{split}/wav/{speaker}/{entry['name']}"
        # Use macOS system trust, not curl's different CA store. The helper
        # bounds bytes/time, requires HTTPS even after redirect, and has no
        # credential/cookie storage. Python verifies the pinned SHA below.
        result = subprocess.run([
            str(fetcher), url, str(raw), str(entry["bytes"]),
        ], capture_output=True, text=True, timeout=55)
        if result.returncode:
            raise RuntimeError(f"Public fixture download failed: {entry['name']}: {result.stderr[-500:]}")
        data = raw.read_bytes()
        assert len(data) == entry["bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"], f"Fixture checksum mismatch: {entry['name']}"
        converted = root / f"16k-{entry['name']}"
        subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(raw), str(converted)], check=True, timeout=30)
        with wave.open(str(converted), "rb") as audio:
            assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
            pcm = audio.readframes(audio.getnframes())
        return entry["name"], pcm

    print(f"Downloading {len(jobs)} pinned public test utterances ({sum(e['bytes'] for _, e in jobs)} bytes) via {source}.", flush=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        frames = dict(executor.map(download, jobs))
    turns = []
    for part in (0, 1):
        for speaker in manifest["speakers"]:
            per_turn = len(speaker["files"]) // 2
            selected = speaker["files"][part * per_turn:(part + 1) * per_turn]
            pcm = b"\0" * 4800
            pcm = pcm.join(frames[entry["name"]] for entry in selected)
            turns.append((speaker["id"], pcm))
    return turns, {
        "dataset": manifest["dataset"], "revision": manifest["revision"],
        "license": manifest["license"], "source": manifest["source"],
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "verifiedFiles": len(jobs), "downloadBytes": sum(e["bytes"] for _, e in jobs),
    }
