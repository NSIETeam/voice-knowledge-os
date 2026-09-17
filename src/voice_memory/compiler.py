from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from difflib import unified_diff

from .models import ConversationRecord, PROFILES


def _managed(section_id: str, body: str, version: int = 1) -> str:
    return (
        f"<!-- voice-memory:managed:start id={section_id} version={version} -->\n"
        f"{body.rstrip()}\n"
        f"<!-- voice-memory:managed:end -->"
    )


_MANAGED_BLOCK = re.compile(
    r"<!-- voice-memory:managed:start id=([A-Za-z0-9_-]+) version=(\d+) -->\r?\n"
    r"(.*?)\r?\n<!-- voice-memory:managed:end -->",
    re.DOTALL,
)


def _managed_blocks(markdown: str) -> dict[str, tuple[str, str]]:
    blocks: dict[str, tuple[str, str]] = {}
    for match in _MANAGED_BLOCK.finditer(markdown):
        block_id = match.group(1)
        if block_id in blocks:
            raise ValueError(f"duplicate managed block: {block_id}")
        blocks[block_id] = (match.group(0), match.group(3))
    starts = markdown.count("<!-- voice-memory:managed:start")
    if starts != len(blocks) or markdown.count("<!-- voice-memory:managed:end -->") != len(blocks):
        raise ValueError("malformed managed block boundary; refusing to overwrite the note")
    return blocks


def _merge_managed(existing: str, generated: str) -> str:
    old_blocks = _managed_blocks(existing)
    new_blocks = _managed_blocks(generated)
    if not old_blocks:
        raise ValueError("existing note has no Voice Memory managed blocks; refusing to overwrite user content")
    newline = "\r\n" if existing.count("\r\n") > existing.count("\n") / 2 else "\n"
    replacements = {
        block_id: value[0].replace("\n", newline)
        for block_id, value in new_blocks.items()
    }
    merged = _MANAGED_BLOCK.sub(
        lambda match: replacements.get(match.group(1), match.group(0)),
        existing,
    )
    return merged


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary_name = stream.name
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def write_source_transcript_snapshot(record: ConversationRecord, vault: str | Path) -> Path:
    transcript_dir = Path(vault) / ".voice-memory" / "transcripts"
    transcript_dir.mkdir(parents=True, exist_ok=True)
    transcript_path = transcript_dir / f"{record.id}.json"
    if transcript_path.exists():
        return transcript_path
    audio = Path(record.audio_path).expanduser()
    source_sha256 = None
    if audio.is_file():
        digest = hashlib.sha256()
        with audio.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        source_sha256 = digest.hexdigest()
    snapshot = {
        "schema_version": "voice-memory.transcript.v1",
        "record_id": record.id,
        "source_sha256": source_sha256,
        "provider": record.transcript_provider,
        "model": record.transcript_model,
        "language": record.transcript_language,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "segments": [
            {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "speaker": segment.speaker,
                "text": segment.text,
                "confidence": segment.confidence,
                "overlap": segment.overlap,
                "unclear": segment.unclear,
                "speaker_status": segment.speaker_status,
                "source": segment.source,
            }
            for segment in record.segments
        ],
    }
    try:
        with transcript_path.open("x", encoding="utf-8") as stream:
            json.dump(snapshot, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except FileExistsError:
        pass
    return transcript_path


def compile_record(record: ConversationRecord) -> str:
    profile = PROFILES.get(record.primary_mode, {"name": record.primary_mode, "extract": []})
    people = "\n".join(f"  - {person}" for person in record.people) or "  - 未确认"
    segment_lines = []
    for segment in record.segments:
        identity = segment.speaker
        speaker_state = {"confirmed": "已确认", "suggestion": "建议", "unknown": "未知"}.get(segment.speaker_status, "未知")
        certainty = f" · 置信度 {segment.confidence:.0%}" if segment.confidence is not None else ""
        flags = " · 重叠发言" if segment.overlap else ""
        flags += " · 不清楚" if segment.unclear else ""
        segment_lines.append(
            f"**{identity}**（{speaker_state}） ({segment.start:.1f}s–{segment.end:.1f}s{certainty}{flags})\n\n"
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
        "audio_asset_id": record.audio_asset_id,
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
        _managed("associations", "## 关联对象\n\n" + links),
        _managed("evidence", "## 证据索引\n\n" + evidence),
        _managed("transcript", "## 原始转写\n\n" + transcript),
        _managed("processing", "## 处理记录\n\n- 首次编译：" + datetime.now(timezone.utc).isoformat()),
        "",
    ])


def write_compiled(
    record: ConversationRecord,
    vault: str | Path,
    correction_history: list[dict] | None = None,
) -> Path:
    vault_path = Path(vault)
    destination = vault_path / "Recordings" / f"{record.title}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    machine_root = vault_path / ".voice-memory"
    sidecar_dir = machine_root / "recordings"
    rollback_dir = machine_root / "rollback" / record.id
    sidecar_dir.mkdir(parents=True, exist_ok=True)
    existing_markdown: str | None = None
    if destination.exists():
        with destination.open("r", encoding="utf-8", newline="") as stream:
            existing_markdown = stream.read()
        rollback_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        shutil.copyfile(destination, rollback_dir / f"{stamp}.md")

    rendered = compile_record(record)
    final_markdown = _merge_managed(existing_markdown, rendered) if existing_markdown is not None else rendered
    if existing_markdown is not None:
        diff_dir = machine_root / "diffs" / record.id
        diff = "".join(unified_diff(
            existing_markdown.splitlines(keepends=True),
            final_markdown.splitlines(keepends=True),
            fromfile=f"{destination.name} (before)",
            tofile=f"{destination.name} (after)",
        ))
        _atomic_write(diff_dir / f"{stamp}.diff", diff)
    _atomic_write(destination, final_markdown)
    audio = Path(record.audio_path).expanduser()
    source_sha256 = None
    if audio.is_file():
        digest = hashlib.sha256()
        with audio.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        source_sha256 = digest.hexdigest()
    write_source_transcript_snapshot(record, vault_path)
    if correction_history is None:
        previous = sidecar_dir / f"{record.id}.json"
        if previous.is_file():
            try:
                correction_history = json.loads(previous.read_text(encoding="utf-8")).get("correction_history", [])
            except (OSError, json.JSONDecodeError):
                correction_history = []
        else:
            correction_history = []
    sidecar = {
        "schema_version": "voice-memory.record.v1",
        "record_id": record.id,
        "source_sha256": source_sha256,
        "provider": record.transcript_provider,
        "model": record.transcript_model,
        "language": record.transcript_language,
        "processing_profile": record.primary_mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "markdown_path": str(destination),
        "record": record.to_dict(),
        "correction_history": correction_history,
    }
    _atomic_write(
        sidecar_dir / f"{record.id}.json",
        json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n",
    )
    return destination
