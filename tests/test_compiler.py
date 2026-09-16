from voice_memory.cli import demo_record
from voice_memory.compiler import compile_record


def test_compiler_preserves_evidence_and_managed_boundaries():
    output = compile_record(demo_record())
    assert "voice-memory:managed:start id=summary" in output
    assert "voice-memory:managed:end" in output
    assert "[[2026-09-16 产品讨论#^seg-0001|原文 00:00]]" in output
    assert "^seg-0002" in output


def test_compiler_exposes_uncertainty():
    record = demo_record()
    record.segments[0].confidence = 0.51
    output = compile_record(record)
    assert "置信度 51%" in output

