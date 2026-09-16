from voice_memory.cli import demo_record
from voice_memory.compiler import compile_record, write_compiled


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


def test_compiler_exposes_review_state():
    record = demo_record()
    record.segments[0].speaker_status = "confirmed"
    record.segments[0].unclear = True
    output = compile_record(record)
    assert "（已确认）" in output
    assert "不清楚" in output


def test_write_compiled_creates_versioned_sidecar_and_rollback(tmp_path):
    record = demo_record()
    record.transcript_provider = "fixture"
    record.transcript_model = "fixture-v1"
    record.transcript_language = "zh"
    audio = tmp_path / "source.m4a"
    audio.write_bytes(b"source-audio")
    record.audio_path = str(audio)
    vault = tmp_path / "vault"

    write_compiled(record, vault)
    first = (vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text()
    assert '"schema_version": "voice-memory.record.v1"' in first
    assert '"source_sha256": "' in first
    assert '"provider": "fixture"' in first
    assert '"model": "fixture-v1"' in first
    assert '"language": "zh"' in first

    record.context = "第二次编译"
    write_compiled(record, vault)
    backups = list((vault / ".voice-memory" / "rollback" / record.id).glob("*.md"))
    assert len(backups) == 1
