# Windows packaging and lifecycle audit

## Why previous iterations kept failing

1. The first installer smoke test stopped at a PowerShell property-count assertion. The API contains seven named profiles, but direct member enumeration was not an explicit collection contract. Compare the actual profile keys now.
2. Closing was delegated to an asynchronous `beforeunload` callback. Window teardown need not wait for the IPC request. Moving it to `onCloseRequested` did not audit its dependencies: neither `shell:allow-kill` nor `core:window:allow-destroy` was granted.
3. The packaged sidecar is a PyInstaller one-file executable with a bootloader and a worker. Killing the directly spawned process alone is not a process-tree lifetime guarantee. The failed run showed two `voice-memory-node` processes at runner cleanup.
4. The Windows entry point lacked a GUI subsystem declaration. A console window could also appear; prior tests did not prove which window received the close request.
5. The smoke test selected the first installed EXE, accepted any service on port 8765, and did not test restart or forced termination. Installation diagnostics were not retained on failure. Workflow-only changes did not trigger the desktop workflow.
6. Debug target tests followed by a separate release build increased feedback latency. Review was reacting to the first failure rather than checking permissions, process ownership, installer behavior and failure evidence together.

## Changes

- Before creating any Tauri window or child, place the Windows desktop into an unnamed, non-inheritable Windows Job Object with `KILL_ON_JOB_CLOSE`. Retain its handle for the desktop process lifetime. OS teardown closes the handle and terminates descendants, including the PyInstaller worker and locally spawned processing tools, even after forced termination. This intentionally terminates active work on desktop exit; it is not a graceful transcription drain or power-loss recovery feature.
- Windows closure no longer depends on frontend IPC. Other desktop close handling has explicit permissions, guarded browser access and reported kill failures.
- Use the Windows GUI subsystem in release builds, and require the expected GUI window title before testing close.
- Extract a strict PowerShell installation test. Select the exact installed EXE, launch from outside the checkout, prove API ownership through process ancestry, compare all profile keys, then exercise normal close, restart/close, forced exit and uninstall. Verify both the port and the packaged worker processes disappear.
- Preserve MSI logs, package SHA-256 and process/listener snapshots as diagnostics even on failure. Add workflow self-trigger paths and parse the acceptance script before expensive builds. Use the release target for Rust tests to reuse compilation work.

## Evidence and boundaries

- Original failures: Desktop runs `35174858931` (profile assertion) and `35175670265` (worker survived desktop exit).
- Local checks: frontend bundle, Windows-target type check of the exact Rust modules, Python regression suite. These do not replace installed Windows validation.
- Acceptance result must come from the workflow for the commit containing this audit; previous runs are not evidence for the new code.
- Hosted Windows CI covers installation and process lifecycle. Physical audio devices, actual Whisper/Ollama inference, recording recovery, signing and updates remain separate acceptance requirements. Existing macOS installer is reused.

References: [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [PyInstaller bootstrap process](https://pyinstaller.org/en/stable/advanced-topics.html#the-bootstrap-process-in-detail).
