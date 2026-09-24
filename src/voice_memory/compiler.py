from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import tempfile
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from difflib import unified_diff

from .models import ConversationRecord, PROFILES, validate_record_id, validate_record_title
from .processing import analysis_matches_transcript, transcript_fingerprint


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
                "speaker_ids": segment.speaker_ids,
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


_FINDING_LABELS = {
    "concepts": "概念",
    "claims": "论点",
    "evidence": "证据",
    "questions": "问题",
    "links": "关联主题",
    "problem": "问题定义",
    "assumptions": "假设",
    "options": "候选方案",
    "decision": "决策",
    "actions": "行动项",
    "metrics": "验证指标",
    "background": "背景",
    "qa": "问答",
    "needs": "需求",
    "quotes": "原话",
    "contradictions": "矛盾信息",
    "insights": "洞察",
    "positions": "立场",
    "interests": "利益诉求",
    "offers": "报价与条件",
    "concessions": "让步",
    "commitments": "承诺",
    "open_terms": "未决条款",
    "people": "人物信息",
    "preferences": "偏好",
    "events": "事件",
    "agreements": "约定",
    "followups": "后续跟进",
    "facts": "事实",
    "timeline": "时间线",
    "participants": "参与者",
    "provenance": "出处",
    "agenda": "议程",
    "progress": "进展",
    "risks": "风险",
    "owners": "负责人",
    "deadlines": "截止时间",
    "next_steps": "下一步",
}


def _evidence_links(record: ConversationRecord, evidence_ids: list[str]) -> str:
    by_id = {segment.id: segment for segment in record.segments}
    return "、".join(by_id[segment_id].evidence(record.title) for segment_id in evidence_ids)


def _model_text(text: str) -> str:
    escaped = html.escape(text.strip(), quote=False)
    for char, entity in (("[", "&#91;"), ("]", "&#93;"), ("`", "&#96;")):
        escaped = escaped.replace(char, entity)
    return escaped.replace("\r", " ").replace("\n", " ")


def compile_record(
    record: ConversationRecord,
    analysis: dict | None = None,
    available_views: list[str] | None = None,
    canonical_profile: str | None = None,
    compiled_at: str | None = None,
) -> str:
    profile = PROFILES.get(record.primary_mode, {"name": record.primary_mode, "extract": []})
    people = "\n".join(f"  - {person}" for person in record.people) or "  - 未确认"
    segment_lines = []
    for segment in record.segments:
        identity = " + ".join(segment.speaker_ids) if segment.speaker_ids else segment.speaker
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
    if available_views:
        canonical_profile = canonical_profile or record.primary_mode
        view_links = "\n".join(
            f"- [[{('Recordings/' + record.title) if mode == canonical_profile else ('Recordings/Views/' + record.id + '/' + mode)}|{PROFILES[mode]['name']}]]"
            for mode in sorted(available_views)
            if mode != record.primary_mode
        )
        links += "\n\n### 其他处理视角\n\n" + view_links
    actions = "_未运行语义处理；不会自动创建任务。_"
    metadata = {
        "voice_memory_id": record.id,
        "created_at": record.created_at,
        "processing_profile": record.primary_mode,
        "processing_profile_name": profile["name"],
        "context": record.context,
        "sensitivity": record.sensitivity,
        "audio": record.audio_path,
        "audio_asset_id": record.audio_asset_id,
        "semantic_processor": analysis.get("provider") if analysis else None,
        "semantic_model": json.dumps(analysis.get("model"), ensure_ascii=False) if analysis else "null",
        "semantic_analysis_current": False,
    }
    analysis_current = bool(
        analysis
        and analysis.get("profile") == record.primary_mode
        and analysis_matches_transcript(record, analysis)
    )
    metadata["semantic_analysis_current"] = analysis_current
    yaml = "\n".join(
        ["---"] + [f"{key}: {value}" for key, value in metadata.items()] + ["people:", people, "---"]
    )
    if analysis_current:
        summary_text = _model_text(analysis["summary"]["text"])
        summary_refs = _evidence_links(record, analysis["summary"]["evidence_ids"])
        findings = "\n".join(
            f"- **{_FINDING_LABELS.get(item['kind'], item['kind'])}**：{_model_text(item['text'])}（{_evidence_links(record, item['evidence_ids'])}）"
            for item in analysis["findings"]
        ) or "- _本机模型未提取到有证据支撑的条目。_"
        summary = (
            f"## 本机模型整理建议（待审核）\n\n{summary_text}（{summary_refs}）\n\n"
            f"### {profile['name']}提取项（待审核）\n\n{findings}\n\n"
            "_以上是本机模型生成的候选内容，不代表已确认事实；请逐条打开证据核验。_"
        )
        if profile.get("create_tasks"):
            task_kinds = {"actions", "commitments", "followups", "next_steps"}
            candidates = [item for item in analysis["findings"] if item["kind"] in task_kinds]
            actions = "\n".join(
                f"- [ ] {_model_text(item['text'])}（待审核；{_evidence_links(record, item['evidence_ids'])}）"
                for item in candidates
            ) or "_模型没有提出带来源证据的行动项。_"
            actions = "## 候选行动项（待用户确认）\n\n" + actions
    elif analysis:
        summary = (
            "## 本机模型整理建议（已过期）\n\n"
            "转写文本、说话人或处理模式在本机模型处理后发生变化。为避免旧结论继续冒充当前证据，"
            "旧分析暂不显示；原结果仍保存在机器 sidecar 中。请重新运行本机语义处理。"
        )
        actions = "_语义结果已过期；重新处理并复核前不会显示或创建候选任务。_"
    else:
        summary = (
            "## 执行摘要\n\n"
            "未配置或未运行本机语义模型。本记录只包含原始转写和可定位证据，不生成摘要或行动项。\n\n"
            f"处理模式：{profile['name']}；提取契约：{', '.join(profile['extract'])}。"
        )
    return "\n\n".join([
        yaml,
        f"# {record.title}",
        _managed("summary", summary),
        _managed("actions", actions),
        _managed("associations", "## 关联对象\n\n" + links),
        _managed("evidence", "## 证据索引\n\n" + evidence),
        _managed("transcript", "## 原始转写\n\n" + transcript),
        _managed(
            "processing",
            "## 处理记录\n\n- 最近重编译：" + (compiled_at or datetime.now(timezone.utc).isoformat())
            + (f"\n- 本机语义处理：{analysis['provider']} / {analysis['model']}（{analysis.get('generated_at', '时间未知')}）" if analysis else "\n- 本机语义处理：未运行")
            + ("\n- 状态：原文、说话人或处理模式已变化；旧分析已标记过期。" if analysis and not analysis_current else ""),
        ),
        "",
    ])


def preview_compiled(
    record: ConversationRecord,
    vault: str | Path,
    analysis: dict,
    compiled_at: str,
) -> list[dict[str, str | None]]:
    """Render every Markdown file a recompile would change without writing anything."""
    validate_record_id(record.id)
    validate_record_title(record.title)
    vault_path = Path(vault).expanduser().resolve()
    sidecar_path = vault_path / ".voice-memory" / "recordings" / f"{record.id}.json"
    try:
        previous = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("record sidecar is unreadable; refusing to preview a recompile") from error
    if previous.get("record_id") != record.id:
        raise ValueError("record sidecar identity does not match")
    analysis_views = dict(previous.get("analysis_views", {}))
    legacy_analysis = previous.get("analysis")
    if not analysis_views and isinstance(legacy_analysis, dict):
        legacy_profile = legacy_analysis.get("profile") or previous.get("processing_profile")
        if legacy_profile not in PROFILES:
            raise ValueError("existing Voice Memory sidecar contains an invalid processing profile")
        analysis_views[legacy_profile] = legacy_analysis
    elif legacy_analysis is not None and not isinstance(legacy_analysis, dict):
        raise ValueError("existing Voice Memory sidecar contains an invalid analysis")
    for mode, view in analysis_views.items():
        if mode not in PROFILES or not isinstance(view, dict) or view.get("profile") != mode:
            raise ValueError("existing Voice Memory sidecar contains an invalid processing view")
    profile = analysis.get("profile")
    if profile not in PROFILES or analysis.get("source_transcript_sha256") != transcript_fingerprint(record):
        raise ValueError("analysis does not match the current record")
    analysis_views[profile] = analysis

    targets = [(record.primary_mode, vault_path / "Recordings" / f"{record.title}.md")]
    targets.extend(
        (mode, vault_path / "Recordings" / "Views" / record.id / f"{mode}.md")
        for mode in sorted(analysis_views)
        if mode != record.primary_mode
    )
    previews: list[dict[str, str | None]] = []
    for mode, target in targets:
        resolved = target.resolve()
        if resolved != target:
            raise ValueError("recompile preview does not support symlinked Vault note paths")
        if not resolved.is_relative_to(vault_path):
            raise ValueError("compiled note path escapes the selected Vault")
        if resolved.is_file():
            with resolved.open("r", encoding="utf-8", newline="") as stream:
                existing = stream.read()
            before_sha256 = hashlib.sha256(resolved.read_bytes()).hexdigest()
        else:
            existing = ""
            before_sha256 = None
        view_record = replace(record, primary_mode=mode)
        rendered = compile_record(
            view_record,
            analysis_views.get(mode),
            sorted(analysis_views),
            canonical_profile=record.primary_mode,
            compiled_at=compiled_at,
        )
        final = _merge_managed(existing, rendered) if existing else rendered
        diff = "".join(unified_diff(
            existing.splitlines(keepends=True),
            final.splitlines(keepends=True),
            fromfile=f"{resolved.name} (before)",
            tofile=f"{resolved.name} (after)",
        ))
        previews.append({"path": str(resolved), "before_sha256": before_sha256, "diff": diff})
    return previews


def write_compiled(
    record: ConversationRecord,
    vault: str | Path,
    correction_history: list[dict] | None = None,
    analysis: dict | None = None,
    compiled_at: str | None = None,
) -> Path:
    validate_record_id(record.id)
    validate_record_title(record.title)
    vault_path = Path(vault)
    destination = vault_path / "Recordings" / f"{record.title}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    machine_root = vault_path / ".voice-memory"
    sidecar_dir = machine_root / "recordings"
    rollback_dir = machine_root / "rollback" / record.id
    sidecar_dir.mkdir(parents=True, exist_ok=True)
    previous_sidecar = sidecar_dir / f"{record.id}.json"
    previous: dict = {}
    if previous_sidecar.is_file():
        try:
            previous = json.loads(previous_sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("existing Voice Memory sidecar is unreadable; refusing to discard its analysis") from error
    analysis_views = dict(previous.get("analysis_views", {}))
    legacy_analysis = previous.get("analysis")
    if not analysis_views and isinstance(legacy_analysis, dict):
        legacy_profile = legacy_analysis.get("profile") or previous.get("processing_profile")
        if legacy_profile not in PROFILES:
            raise ValueError("existing Voice Memory sidecar contains an invalid processing profile")
        analysis_views[legacy_profile] = legacy_analysis
    elif legacy_analysis is not None and not isinstance(legacy_analysis, dict):
        raise ValueError("existing Voice Memory sidecar contains an invalid analysis")
    for mode, view in analysis_views.items():
        if mode not in PROFILES or not isinstance(view, dict) or view.get("profile") != mode:
            raise ValueError("existing Voice Memory sidecar contains an invalid processing view")
    if analysis is not None:
        profile = analysis.get("profile")
        if profile not in PROFILES:
            raise ValueError("analysis references an unknown processing profile")
        analysis_views[profile] = analysis
    primary_analysis = analysis_views.get(record.primary_mode)
    alternate_views = sorted(mode for mode in analysis_views if mode != record.primary_mode)
    existing_markdown: str | None = None
    if destination.exists():
        with destination.open("r", encoding="utf-8", newline="") as stream:
            existing_markdown = stream.read()
        rollback_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        shutil.copyfile(destination, rollback_dir / f"{stamp}.md")

    rendered = compile_record(record, primary_analysis, sorted(analysis_views), record.primary_mode, compiled_at)
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
    view_paths: dict[str, str] = {}
    for mode in alternate_views:
        view_record = replace(record, primary_mode=mode)
        view_destination = vault_path / "Recordings" / "Views" / record.id / f"{mode}.md"
        view_destination.parent.mkdir(parents=True, exist_ok=True)
        existing_view: str | None = None
        if view_destination.exists():
            with view_destination.open("r", encoding="utf-8", newline="") as stream:
                existing_view = stream.read()
        rendered_view = compile_record(
            view_record,
            analysis_views[mode],
            sorted(analysis_views),
            canonical_profile=record.primary_mode,
            compiled_at=compiled_at,
        )
        final_view = _merge_managed(existing_view, rendered_view) if existing_view is not None else rendered_view
        if existing_view is not None:
            stamp_view = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            view_rollback = rollback_dir / f"{mode}-{stamp_view}.md"
            view_rollback.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(view_destination, view_rollback)
            view_diff_dir = machine_root / "diffs" / record.id
            view_diff = "".join(unified_diff(
                existing_view.splitlines(keepends=True),
                final_view.splitlines(keepends=True),
                fromfile=f"{view_destination.name} (before)",
                tofile=f"{view_destination.name} (after)",
            ))
            _atomic_write(view_diff_dir / f"{mode}-{stamp_view}.diff", view_diff)
        _atomic_write(view_destination, final_view)
        view_paths[mode] = str(view_destination)
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
        "analysis": primary_analysis,
        "analysis_views": analysis_views,
        "analysis_view_paths": {record.primary_mode: str(destination), **view_paths},
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
