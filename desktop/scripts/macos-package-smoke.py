#!/usr/bin/env python3
"""Launch the packaged Apple Silicon app in an isolated home and check its API."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = "aarch64-apple-darwin"
API = "http://127.0.0.1:8765"
EXPECTED_PROFILES = {
    "knowledge", "decision", "interview", "negotiation",
    "relationship", "evidence", "operations",
}


def processes() -> list[dict[str, int | str]]:
    result = subprocess.run(
        ["ps", "-Ao", "pid=,ppid=,command="],
        check=True, capture_output=True, text=True,
    )
    rows = []
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            try:
                rows.append({"pid": int(fields[0]), "ppid": int(fields[1]), "command": fields[2]})
            except ValueError:
                continue
    return rows


def listener_pids() -> list[int]:
    result = subprocess.run(
        ["lsof", "-nP", "-t", "-iTCP:8765", "-sTCP:LISTEN"],
        capture_output=True, text=True,
    )
    return sorted({int(item) for item in result.stdout.split() if item.isdigit()})


def assert_owned_listener(app: subprocess.Popen[bytes]) -> None:
    listeners = listener_pids()
    if len(listeners) != 1:
        raise RuntimeError(f"expected one local API listener, got {listeners}")
    by_pid = {int(row["pid"]): row for row in processes()}
    ancestor = listeners[0]
    for _ in range(20):
        if ancestor == app.pid:
            return
        row = by_pid.get(ancestor)
        if row is None:
            break
        ancestor = int(row["ppid"])
    raise RuntimeError(f"API listener {listeners[0]} does not belong to desktop PID {app.pid}")


def health() -> dict | None:
    try:
        with urllib.request.urlopen(f"{API}/health", timeout=1) as response:
            return json.load(response)
    except (OSError, urllib.error.URLError, TimeoutError):
        return None


def stop_tree(app: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(app.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if app.poll() is None:
        app.wait(timeout=10)


def main() -> int:
    diagnostics = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"voice-memory-{TARGET}-smoke"
    home = diagnostics / "home"
    diagnostics.mkdir(parents=True, exist_ok=True)
    home.mkdir(parents=True, exist_ok=True)
    disk_images = list((ROOT / "src-tauri" / "target" / TARGET / "release" / "bundle" / "dmg").glob("*.dmg"))
    if len(disk_images) != 1:
        raise RuntimeError(f"expected one Apple Silicon DMG, got {disk_images}")
    mountpoint = diagnostics / "mounted-installer"
    mountpoint.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", str(mountpoint), str(disk_images[0])],
        check=True, timeout=30, capture_output=True, text=True,
    )
    app = None
    try:
        candidates = list(mountpoint.glob("*.app"))
        if len(candidates) != 1:
            raise RuntimeError(f"expected one app in DMG, got {candidates}")
        installed_apps = home / "Applications"
        installed_apps.mkdir(parents=True, exist_ok=True)
        app_path = installed_apps / candidates[0].name
        subprocess.run(["ditto", str(candidates[0]), str(app_path)], check=True, timeout=60)
    finally:
        subprocess.run(["hdiutil", "detach", str(mountpoint)], capture_output=True, text=True, timeout=30)
    executable = app_path / "Contents" / "MacOS" / "voice-memory-desktop"
    if not executable.is_file():
        raise FileNotFoundError(f"packaged application is missing: {executable}")
    if listener_pids():
        raise RuntimeError("runner already has a listener on port 8765")

    env = os.environ.copy()
    env["HOME"] = str(home)
    env["TMPDIR"] = str(diagnostics)
    app_log = diagnostics / "desktop.log"
    app = subprocess.Popen(
        [str(executable)], cwd=home, env=env,
        stdin=subprocess.DEVNULL, stdout=app_log.open("wb"), stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 45
        payload = None
        while time.monotonic() < deadline:
            if app.poll() is not None:
                raise RuntimeError(f"packaged app exited during startup ({app.returncode})")
            payload = health()
            if payload:
                break
            time.sleep(0.2)
        if not payload or payload != {"status": "ok", "service": "voice-memory"}:
            raise RuntimeError("packaged app failed to start its local API")
        assert_owned_listener(app)
        with urllib.request.urlopen(f"{API}/profiles", timeout=5) as response:
            profiles = json.load(response)
        if set(profiles) != EXPECTED_PROFILES:
            raise RuntimeError(f"unexpected processing profiles: {sorted(profiles)}")
        print("PASS: installed Apple Silicon app starts its owned local API with all seven profiles", flush=True)

        # Ask LaunchServices to quit the app so macOS follows its normal window close path.
        subprocess.run(
            ["osascript", "-e", 'tell application id "com.voicememory.desktop" to quit'],
            check=True, timeout=15, capture_output=True, text=True,
        )
        try:
            app.wait(timeout=20)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("app did not exit after the normal macOS quit request") from error
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and (listener_pids() or any(
            "voice-memory-node" in str(row["command"]) for row in processes()
        )):
            time.sleep(0.2)
        leftovers = {
            "listeners": listener_pids(),
            "sidecars": [row for row in processes() if "voice-memory-node" in str(row["command"])],
        }
        (diagnostics / "post-close-processes.json").write_text(json.dumps(leftovers, indent=2))
        if leftovers["listeners"] or leftovers["sidecars"]:
            raise RuntimeError(f"app quit left local processing processes behind: {leftovers}")
        print("PASS: normal macOS quit closed the app and its sidecar process tree", flush=True)
        return 0
    finally:
        if app is not None:
            stop_tree(app)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        diagnostics = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"voice-memory-{TARGET}-smoke"
        diagnostics.mkdir(parents=True, exist_ok=True)
        (diagnostics / "failure.txt").write_text(f"{type(error).__name__}: {error}\n")
        for name, command in (
            ("failure-processes.txt", ["ps", "-Ao", "pid=,ppid=,command="]),
            ("failure-listeners.txt", ["lsof", "-nP", "-iTCP:8765", "-sTCP:LISTEN"]),
        ):
            result = subprocess.run(command, capture_output=True, text=True)
            (diagnostics / name).write_text(result.stdout + result.stderr)
        print(f"FAIL: {error}", file=sys.stderr, flush=True)
        raise
