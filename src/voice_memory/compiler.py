from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from .models import ConversationRecord, PROFILES


def _managed(section_id: str, body: str, version: int = 1) -> str:
    return (
        f"<!-- voice-memory:managed:start id={section_id} version={version} -->\n"
        f"{body.rstrip()}\n"
        f"<!-- voice-memory:managed:end -->"
    )


def compile_record(record: ConversationRecord) -> str:
    profile = PROFILES.get(record.primary_mode, {"name": record.primary_mode, "extract": []})
    people = "\n".join(f"  - {person}" for person in record.people) or "  - 未确认"
    segment_lines = []
    for segment in record.segments:
        identity = segment.speaker
        certainty = f" · 置信度 {segment.confidence:.0%}" if segment.confidence is not None else ""
        flags = " · 重叠发言" if segment.overlap else ""
        segment_lines.append(
            f"**{identity}** ({segment.start:.1f}s–{segment.end:.1f}s{certainty}{flags})\n\n"
            f"{segment.text} ^{segment.id}"
        )
    transcript = "\n\n---\n\n".join(segment_lines) or "_尚未导入转写。_"
    evidence = "\n".join(
        f"- {segment.evidence(record.title)} — {segment.text[:80]}"
        for segment in record.segments
    ) or "- _处理后将自动生成证据引用。_"
    links = "\n".join(f"- {value}" for value in [*record.people, record.company, record.project] if value)
    links = links or "- _暂无关联对象。_"
    actions = "\n".join(f"- [ ] 待从“{profile['name']}”处理器确认行动项" for _ in [0])
    metadata = {
        "voice_memory_id": record.id,
        "created_at": record.created_at,
        "processing_profile": record.primary_mode,
        "processing_profile_name": profile["name"],
        "context": record.context,
        "sensitivity": record.sensitivity,
        "audio": record.audio_path,
    }
    yaml = "\n".join(
        ["---"] + [f"{key}: {value}" for key, value in metadata.items()] + ["people:", people, "---"]
    )
    summary = (
        f"## 执行摘要\n\n"
        f"本记录使用“{profile['name']}”处理器，当前提取维度：{', '.join(profile['extract'])}。\n\n"
        f"_摘要必须能够回到下方原始证据；未经用户确认的身份和结论不得视为事实。_"
    )
    return "\n\n".join([
        yaml,
        f"# {record.title}",
        _managed("summary", summary),
        _managed("actions", actions),
        "## 关联对象\n\n" + links,
        "## 证据索引\n\n" + evidence,
        "## 原始转写\n\n" + transcript,
        "## 处理记录\n\n- 首次编译：" + datetime.now(timezone.utc).isoformat(),
        "",
    ])


def write_compiled(record: ConversationRecord, vault: str | Path) -> Path:
    destination = Path(vault) / "Recordings" / f"{record.title}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(compile_record(record), encoding="utf-8")
    return destination

