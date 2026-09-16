"""Dependency-free acceptance smoke test for constrained environments."""

from voice_memory.cli import demo_record
from voice_memory.compiler import compile_record


def main() -> None:
    output = compile_record(demo_record())
    required = (
        "voice-memory:managed:start id=summary",
        "voice-memory:managed:end",
        "[[2026-09-16 产品讨论#^seg-0001|原文 00:00]]",
        "^seg-0002",
    )
    for marker in required:
        assert marker in output, marker
    print("voice-memory smoke test: PASS")


if __name__ == "__main__":
    main()

