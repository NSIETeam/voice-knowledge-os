import json

import pytest

from voice_memory.cli import demo_record
from voice_memory.compiler import compile_record, write_compiled
from voice_memory.processing import transcript_fingerprint


def test_compiler_preserves_evidence_and_managed_boundaries():
    output = compile_record(demo_record())
    assert "voice-memory:managed:start id=summary" in output
    assert "voice-memory:managed:end" in output
    assert "[[2026-09-16 产品讨论#^seg-0001|原文 00:00]]" in output
    assert "^seg-0002" in output


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "../outside"),
        ("title", "CON.txt"),
        ("title", "trailing."),
        ("title", "😀" * 91),
        ("id", "../outside"),
        ("id", "CON"),
    ],
)
def test_write_compiled_rejects_unsafe_path_components_before_writing(tmp_path, field, value):
    record = demo_record()
    setattr(record, field, value)
    vault = tmp_path / "vault"

    with pytest.raises(ValueError):
        write_compiled(record, vault)

    assert not vault.exists()


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


def test_compiler_renders_evidence_linked_local_analysis_as_unreviewed():
    record = demo_record()
    analysis = {
        "schema_version": "voice-memory.analysis.v1",
        "provider": "ollama-local",
        "model": "fixture-model",
        "profile": "decision",
        "source_transcript_sha256": transcript_fingerprint(record),
        "summary": {"text": "只做第一阶段 [打开链接](https://example.invalid) `code`", "evidence_ids": ["seg-0001"]},
        "findings": [
            {"kind": "decision", "text": "选桌面端 <!-- voice-memory:managed:end -->", "evidence_ids": ["seg-0001"]},
            {"kind": "actions", "text": "待审核跟进", "evidence_ids": ["seg-0002"]},
        ],
    }

    output = compile_record(record, analysis)

    assert "本机模型整理建议（待审核）" in output
    assert "semantic_analysis_current: True" in output
    assert "[[2026-09-16 产品讨论#^seg-0001|原文 00:00]]" in output
    assert "&#91;打开链接&#93;" in output
    assert "&#96;code&#96;" in output
    assert "&lt;!-- voice-memory:managed:end --&gt;" in output
    assert "- [ ] 待审核跟进（待审核；[[2026-09-16 产品讨论#^seg-0002|原文 00:18]]）" in output


def test_compiler_does_not_fabricate_summary_or_tasks_without_analysis():
    output = compile_record(demo_record())
    assert "不会自动创建任务" in output
    assert "待从“方案与决策”处理器确认行动项" not in output


def test_compiler_keeps_multiple_profile_views_without_changing_the_record(tmp_path):
    record = demo_record()
    vault = tmp_path / "vault"
    decision = {
        "schema_version": "voice-memory.analysis.v1",
        "provider": "ollama-local",
        "model": "fixture-model",
        "profile": "decision",
        "source_transcript_sha256": transcript_fingerprint(record),
        "summary": {"text": "决策视角结论", "evidence_ids": ["seg-0001"]},
        "findings": [{"kind": "decision", "text": "保留原始记录模式", "evidence_ids": ["seg-0001"]}],
    }
    knowledge = {
        **decision,
        "profile": "knowledge",
        "summary": {"text": "知识视角结论", "evidence_ids": ["seg-0002"]},
        "findings": [{"kind": "claims", "text": "另一个观察角度", "evidence_ids": ["seg-0002"]}],
    }

    canonical = write_compiled(record, vault, analysis=decision)
    write_compiled(record, vault, analysis=knowledge)

    sidecar_path = vault / ".voice-memory" / "recordings" / f"{record.id}.json"
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert sidecar["record"]["primary_mode"] == "decision"
    assert set(sidecar["analysis_views"]) == {"decision", "knowledge"}
    assert "决策视角结论" in canonical.read_text(encoding="utf-8")
    assert "知识视角结论" in (vault / "Recordings" / "Views" / record.id / "knowledge.md").read_text(encoding="utf-8")
    assert f"[[Recordings/Views/{record.id}/knowledge|知识学习]]" in canonical.read_text(encoding="utf-8")

    record.segments[0].text = "转写被人工校正"
    write_compiled(record, vault)
    assert "本机模型整理建议（已过期）" in canonical.read_text(encoding="utf-8")
    assert "本机模型整理建议（已过期）" in (vault / "Recordings" / "Views" / record.id / "knowledge.md").read_text(encoding="utf-8")


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
    first = (vault / ".voice-memory" / "recordings" / f"{record.id}.json").read_text(encoding="utf-8")
    assert '"schema_version": "voice-memory.record.v1"' in first
    assert '"source_sha256": "' in first
    assert '"provider": "fixture"' in first
    assert '"model": "fixture-v1"' in first
    assert '"language": "zh"' in first

    record.context = "第二次编译"
    write_compiled(record, vault)
    backups = list((vault / ".voice-memory" / "rollback" / record.id).glob("*.md"))
    assert len(backups) == 1


def test_recompile_updates_only_managed_blocks_and_records_diff(tmp_path):
    record = demo_record()
    vault = tmp_path / "vault"
    note = write_compiled(record, vault)
    before = note.read_text(encoding="utf-8")
    personal = "\n\n## 我的补充\n\n这段由用户撰写，必须逐字保留。\n\n"
    action_marker = "<!-- voice-memory:managed:start id=actions"
    note.write_text(before.replace(action_marker, personal + action_marker), encoding="utf-8")

    record.segments[0].text = "人工修订后的原文"
    write_compiled(record, vault)

    after = note.read_text(encoding="utf-8")
    assert personal in after
    assert "人工修订后的原文" in after
    assert "第一阶段先做桌面端本地处理" not in after
    backups = list((vault / ".voice-memory" / "rollback" / record.id).glob("*.md"))
    diffs = list((vault / ".voice-memory" / "diffs" / record.id).glob("*.diff"))
    assert len(backups) == 1
    assert len(diffs) == 1
    assert "人工修订后的原文" in diffs[0].read_text(encoding="utf-8")


def test_recompile_refuses_to_replace_note_without_managed_blocks(tmp_path):
    record = demo_record()
    vault = tmp_path / "vault"
    note = vault / "Recordings" / f"{record.title}.md"
    note.parent.mkdir(parents=True)
    note.write_text("# My existing note\n\nUser-authored content.\n", encoding="utf-8")

    with pytest.raises(ValueError, match="refusing to overwrite user content"):
        write_compiled(record, vault)
    assert note.read_text(encoding="utf-8") == "# My existing note\n\nUser-authored content.\n"


def test_managed_boundaries_are_validated_before_replacement(tmp_path):
    record = demo_record()
    vault = tmp_path / "vault"
    note = write_compiled(record, vault)
    content = note.read_text(encoding="utf-8").replace("<!-- voice-memory:managed:end -->", "", 1)
    note.write_text(content, encoding="utf-8")

    with pytest.raises(ValueError, match="malformed managed block boundary"):
        write_compiled(record, vault)
    assert note.read_text(encoding="utf-8") == content


def test_recompile_preserves_windows_line_endings_outside_managed_blocks(tmp_path):
    record = demo_record()
    vault = tmp_path / "vault"
    note = write_compiled(record, vault)
    original = note.read_text(encoding="utf-8").replace("\n", "\r\n")
    user_text = "## Windows 用户补充\r\n\r\n保留 CRLF 与原文。\r\n\r\n"
    note.write_bytes(original.replace(
        "<!-- voice-memory:managed:start id=actions",
        user_text + "<!-- voice-memory:managed:start id=actions",
    ).encode("utf-8"))

    record.segments[0].text = "修订内容"
    write_compiled(record, vault)

    with note.open("r", encoding="utf-8", newline="") as stream:
        updated = stream.read()
    assert user_text in updated
    assert "<!-- voice-memory:managed:start id=transcript version=1 -->\r\n" in updated
    assert "修订内容" in updated
