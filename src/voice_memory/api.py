from __future__ import annotations

import json
from urllib.parse import parse_qs, unquote, urlsplit
import base64
import errno
import hashlib
import mimetypes
import os
import re
import secrets
import threading
import time
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .ledger import AudioLedger
from .compiler import preview_compiled, write_compiled
from .jobs import JobStore
from .models import ConversationRecord, PROFILES, Segment, validate_record_title
from .transcription import FixtureProvider, WhisperCppProvider
from .review import apply_correction
from .processing import LocalOllamaProcessor, analysis_matches_transcript


INDEX_HTML = """<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>Voice Memory</title>
<style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:0 20px;color:#202124}button{padding:8px 14px}code{background:#f1f3f4;padding:2px 5px}section{border:1px solid #ddd;border-radius:10px;padding:18px;margin:16px 0}</style>
<h1>Voice Memory</h1><p>Local-first voice knowledge compiler</p>
<section><h2>本地状态</h2><p id="health">读取中…</p><p id="profiles">处理模式读取中…</p></section>
<section><h2>下一步</h2><p>使用 CLI 导入并编译：<code>voice-memory demo /path/to/vault</code></p><p>API 默认只监听 <code>127.0.0.1</code>，不会向局域网暴露录音。</p></section>
<script>Promise.all([fetch('/health').then(r=>r.json()),fetch('/profiles').then(r=>r.json())]).then(([h,p])=>{health.textContent=h.status==='ok'?'服务正常':'服务异常';profiles.textContent=`已加载 ${Object.keys(p).length} 个处理模式`})</script>
</html>"""


class VoiceMemoryHandler(BaseHTTPRequestHandler):
    ledger: AudioLedger
    jobs: JobStore
    allowed_origins = {"http://tauri.localhost", "tauri://localhost", "http://127.0.0.1:8765", "http://localhost:8765", "app://obsidian.md"}
    allowed_headers = ("Content-Type", "X-File-Name", "X-Audio-Source")
    _index_lock = threading.Lock()
    _record_write_lock = threading.RLock()
    _pending_reprocess_lock = threading.Lock()
    _pending_reprocess: dict[str, dict[str, Any]] = {}
    _pending_reprocess_ttl = 600
    _pending_reprocess_limit = 32

    @classmethod
    def _prune_pending_reprocess(cls) -> None:
        now = time.monotonic()
        expired = [key for key, value in cls._pending_reprocess.items() if value["expires_at"] <= now]
        for key in expired:
            cls._pending_reprocess.pop(key, None)

    def _record_sidecar(self, record_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", record_id):
            raise FileNotFoundError(record_id)
        index_path = self.data_root / "record-index.json"
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}
        path = Path(index.get(record_id, "")).resolve()
        if path.name != f"{record_id}.json" or path.parent.name != "recordings" or path.parent.parent.name != ".voice-memory" or not path.is_file():
            raise FileNotFoundError(record_id)
        return path

    def _register_record(self, record_id: str, sidecar: Path) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        with self._index_lock:
            index_path = self.data_root / "record-index.json"
            index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}
            index[record_id] = str(sidecar.resolve())
            temporary = index_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(index_path)

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in self.allowed_origins else None

    def _trusted_request_origin(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in self.allowed_origins

    def _reject_untrusted_origin(self) -> bool:
        if self._trusted_request_origin():
            return False
        self._json(HTTPStatus.FORBIDDEN, {"error": "untrusted_origin"})
        return True

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", ", ".join(self.allowed_headers))
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._reject_untrusted_origin():
            return
        self.send_response(204)
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", ", ".join(self.allowed_headers))
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self._reject_untrusted_origin():
            return
        if urlsplit(self.path).path == "/records":
            try:
                index_path = self.data_root / "record-index.json"
                index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}
                if not isinstance(index, dict):
                    raise ValueError("record index must be a JSON object")
                query = parse_qs(urlsplit(self.path).query).get("q", [""])[0].strip().casefold()
                records = []
                for record_id, indexed_path in index.items():
                    if not isinstance(record_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", record_id):
                        continue
                    if not isinstance(indexed_path, str):
                        continue
                    sidecar_path = Path(indexed_path).resolve()
                    if (
                        sidecar_path.name != f"{record_id}.json"
                        or sidecar_path.parent.name != "recordings"
                        or sidecar_path.parent.parent.name != ".voice-memory"
                        or not sidecar_path.is_file()
                    ):
                        continue
                    try:
                        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
                        record = sidecar.get("record")
                        if sidecar.get("record_id") != record_id or not isinstance(record, dict):
                            continue
                        title = str(record.get("title", ""))
                        profile = str(record.get("primary_mode", ""))
                        created_at = str(record.get("created_at", ""))
                        if query and query not in f"{title} {profile}".casefold():
                            continue
                        records.append({
                            "id": record_id,
                            "title": title,
                            "created_at": created_at,
                            "primary_mode": profile,
                            "segment_count": len(record.get("segments", [])) if isinstance(record.get("segments"), list) else 0,
                            "audio_asset_id": record.get("audio_asset_id"),
                        })
                    except (OSError, json.JSONDecodeError):
                        continue
                records.sort(key=lambda item: item["created_at"], reverse=True)
                self._json(HTTPStatus.OK, {"records": records[:100], "total": len(records)})
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"record_index_unavailable: {error}"})
        elif self.path == "/":
            body = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            origin = self._cors_origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "service": "voice-memory"})
        elif self.path == "/profiles":
            self._json(HTTPStatus.OK, PROFILES)
        elif self.path.startswith("/ledger/") and self.path.endswith("/content"):
            asset_id = unquote(self.path.removeprefix("/ledger/").removesuffix("/content")).strip()
            try:
                asset = self.ledger.get(asset_id)
                source = Path(asset.stored_path).resolve()
                objects = self.ledger.objects.resolve()
                if source.parent != objects or not source.is_file():
                    raise FileNotFoundError(asset_id)
                content_type = mimetypes.guess_type(asset.original_name)[0] or "application/octet-stream"
                size = source.stat().st_size
                range_header = self.headers.get("Range")
                start, end = 0, size - 1
                status = HTTPStatus.OK
                if range_header:
                    try:
                        unit, value = range_header.split("=", 1)
                        if unit != "bytes" or "," in value:
                            raise ValueError
                        first, last = value.split("-", 1)
                        if first:
                            start = int(first)
                            end = min(int(last), size - 1) if last else size - 1
                        else:
                            suffix = int(last)
                            if suffix <= 0:
                                raise ValueError
                            start = max(0, size - suffix)
                        if start < 0 or start >= size or end < start:
                            raise ValueError
                        status = HTTPStatus.PARTIAL_CONTENT
                    except (ValueError, TypeError):
                        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Accept-Ranges", "bytes")
                origin = self._cors_origin()
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                    self.send_header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range")
                if status == HTTPStatus.PARTIAL_CONTENT:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                with source.open("rb") as stream:
                    stream.seek(start)
                    self.wfile.write(stream.read(end - start + 1))
            except (KeyError, FileNotFoundError):
                self._json(HTTPStatus.NOT_FOUND, {"error": "audio_asset_not_found"})
        elif self.path.startswith("/jobs/"):
            job_id = unquote(self.path.removeprefix("/jobs/")).strip()
            try:
                self._json(HTTPStatus.OK, self.jobs.get(job_id).__dict__)
            except (KeyError, FileNotFoundError):
                self._json(HTTPStatus.NOT_FOUND, {"error": "job_not_found"})
        elif self.path.startswith("/records/"):
            record_id = unquote(self.path.removeprefix("/records/")).strip()
            try:
                sidecar_path = self._record_sidecar(record_id)
                sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
                if sidecar.get("record_id") != record_id:
                    raise FileNotFoundError(record_id)
                record_data = sidecar.get("record")
                views = sidecar.get("analysis_views") or {}
                if not views and isinstance(sidecar.get("analysis"), dict):
                    legacy = sidecar["analysis"]
                    legacy_profile = legacy.get("profile") or (record_data or {}).get("primary_mode")
                    if legacy_profile:
                        views = {legacy_profile: legacy}
                try:
                    record = ConversationRecord(
                        **{key: value for key, value in record_data.items() if key != "segments"},
                        segments=[Segment(**segment) for segment in record_data.get("segments", [])],
                    )
                    sidecar["analysis_views_current"] = {
                        profile: bool(view.get("profile") == profile and analysis_matches_transcript(record, view))
                        for profile, view in views.items()
                        if isinstance(view, dict)
                    }
                except (AttributeError, TypeError, ValueError):
                    sidecar["analysis_views_current"] = {}
                self._json(HTTPStatus.OK, sidecar)
            except FileNotFoundError:
                self._json(HTTPStatus.NOT_FOUND, {"error": "record_not_found"})
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self._reject_untrusted_origin():
            return
        if self.path.startswith("/records/") and self.path.endswith("/reprocess/cancel"):
            if self.headers.get_content_type() != "application/json":
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_json"})
                return
            record_id = unquote(self.path.removeprefix("/records/").removesuffix("/reprocess/cancel")).strip()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                preview_id = payload.get("preview_id") if isinstance(payload, dict) else None
                if not isinstance(preview_id, str):
                    raise ValueError("preview_id is required")
                already_approved = False
                with self._pending_reprocess_lock:
                    pending = self._pending_reprocess.get(preview_id)
                    if pending and pending["record_id"] == record_id:
                        already_approved = bool(pending.get("approved_result"))
                        if not already_approved:
                            self._pending_reprocess.pop(preview_id, None)
                self._json(HTTPStatus.OK, {"cancelled": not already_approved, "already_approved": already_approved})
            except (ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.path.startswith("/records/") and self.path.endswith("/reprocess/approve"):
            if self.headers.get_content_type() != "application/json":
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_json"})
                return
            record_id = unquote(self.path.removeprefix("/records/").removesuffix("/reprocess/approve")).strip()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or not isinstance(payload.get("preview_id"), str):
                    raise ValueError("preview_id is required")
                preview_id = payload["preview_id"]
                with self._record_write_lock:
                    with self._pending_reprocess_lock:
                        self._prune_pending_reprocess()
                        pending = self._pending_reprocess.get(preview_id)
                        if not pending or pending["record_id"] != record_id:
                            self._json(HTTPStatus.GONE, {"error": "preview_expired_or_not_found"})
                            return
                        if pending.get("approved_result"):
                            self._json(HTTPStatus.OK, pending["approved_result"])
                            return
                        sidecar_path = self._record_sidecar(record_id)
                        if hashlib.sha256(sidecar_path.read_bytes()).hexdigest() != pending["sidecar_sha256"]:
                            self._json(HTTPStatus.CONFLICT, {"error": "record_changed_after_preview; create_a_new_preview"})
                            return
                        for note in pending["notes"]:
                            path = Path(note["absolute_path"])
                            if path.resolve() != path or not path.resolve().is_relative_to(Path(pending["vault"]).resolve()):
                                self._json(HTTPStatus.CONFLICT, {"error": "vault_path_changed_after_preview; create_a_new_preview"})
                                return
                            current_hash = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
                            if current_hash != note["before_sha256"]:
                                self._json(HTTPStatus.CONFLICT, {"error": "vault_note_changed_after_preview; create_a_new_preview"})
                                return
                        if not analysis_matches_transcript(pending["record"], pending["analysis"]):
                            self._json(HTTPStatus.CONFLICT, {"error": "preview_analysis_no_longer_matches_record"})
                            return
                        destination = write_compiled(
                            pending["record"], pending["vault"],
                            correction_history=pending["correction_history"],
                            analysis=pending["analysis"],
                            compiled_at=pending["compiled_at"],
                        )
                        updated = json.loads(sidecar_path.read_text(encoding="utf-8"))
                        view_path = updated.get("analysis_view_paths", {}).get(pending["profile"])
                        result = {
                            "record": updated["record"],
                            "analysis": updated.get("analysis_views", {}).get(pending["profile"]),
                            "view_path": view_path or str(destination),
                            "files": [note["relative_path"] for note in pending["notes"]],
                        }
                        pending["approved_result"] = result
                        pending["expires_at"] = time.monotonic() + self._pending_reprocess_ttl
                self._json(HTTPStatus.OK, result)
            except (FileNotFoundError, KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.path.startswith("/records/") and self.path.endswith("/reprocess"):
            if self.headers.get_content_type() != "application/json":
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_json"})
                return
            record_id = unquote(self.path.removeprefix("/records/").removesuffix("/reprocess")).strip()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("request body must be a JSON object")
                sidecar_path = self._record_sidecar(record_id)
                sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
                if sidecar.get("record_id") != record_id:
                    raise FileNotFoundError(record_id)
                data = dict(sidecar["record"])
                record = ConversationRecord(**{key: value for key, value in data.items() if key != "segments"})
                record.segments = [Segment(**segment) for segment in data.get("segments", [])]
                vault = sidecar_path.parent.parent.parent
                sidecar_sha256 = hashlib.sha256(sidecar_path.read_bytes()).hexdigest()
                profile = payload.get("primary_mode", record.primary_mode)
                if profile not in PROFILES:
                    raise ValueError("unknown processing profile")
                processing_record = replace(record, primary_mode=profile)
                analysis = LocalOllamaProcessor(
                    payload.get("processor_endpoint", "http://127.0.0.1:11434"),
                    payload.get("processor_model", ""),
                ).process(processing_record)
                compiled_at = datetime.now(timezone.utc).isoformat()
                with self._record_write_lock:
                    if hashlib.sha256(sidecar_path.read_bytes()).hexdigest() != sidecar_sha256:
                        self._json(HTTPStatus.CONFLICT, {"error": "record_changed_during_preview; retry"})
                        return
                    notes = preview_compiled(record, vault, analysis, compiled_at)
                    total_diff = sum(len((note["diff"] or "").encode("utf-8")) for note in notes)
                    if total_diff > 1_000_000:
                        self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "preview_exceeds_one_megabyte; narrow_the_record_before_reprocessing"})
                        return
                    pending_notes = [
                        {**note, "absolute_path": note["path"], "relative_path": os.path.relpath(note["path"], vault)}
                        for note in notes
                    ]
                    with self._pending_reprocess_lock:
                        self._prune_pending_reprocess()
                        if len(self._pending_reprocess) >= self._pending_reprocess_limit:
                            self._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_pending_previews; wait_for_expiry_or_approve_one"})
                            return
                        preview_id = secrets.token_urlsafe(32)
                        self._pending_reprocess[preview_id] = {
                            "record_id": record_id,
                            "vault": vault,
                            "record": record,
                            "correction_history": sidecar.get("correction_history", []),
                            "analysis": analysis,
                            "profile": profile,
                            "compiled_at": compiled_at,
                            "sidecar_sha256": sidecar_sha256,
                            "notes": pending_notes,
                            "expires_at": time.monotonic() + self._pending_reprocess_ttl,
                        }
                self._json(HTTPStatus.OK, {
                    "preview_id": preview_id,
                    "profile": profile,
                    "files": [{"path": note["relative_path"], "diff": note["diff"]} for note in pending_notes],
                    "expires_in_seconds": self._pending_reprocess_ttl,
                    "approval_required": True,
                })
            except (FileNotFoundError, KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.path.startswith("/records/") and self.path.endswith("/corrections"):
            if self.headers.get_content_type() != "application/json":
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_json"})
                return
            record_id = unquote(self.path.removeprefix("/records/").removesuffix("/corrections")).strip()
            length = int(self.headers.get("Content-Length", "0"))
            try:
                payload = json.loads(self.rfile.read(length))
                sidecar_path = self._record_sidecar(record_id)
                with self._record_write_lock:
                    result = apply_correction(sidecar_path.parent.parent, record_id, payload)
                self._json(HTTPStatus.OK, result)
            except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.path not in ("/ledger/import", "/ledger/upload", "/records/compile", "/transcribe", "/records/from-job"):
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if self.path == "/ledger/upload":
            if self.headers.get_content_type() != "application/octet-stream":
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_octet_stream"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                original_name = unquote(self.headers.get("X-File-Name", "recording.audio"))
                original_name = original_name.replace("\\", "/").split("/")[-1].strip()
                original_name = "".join(char for char in original_name if ord(char) >= 32)[:255] or "recording.audio"
                source_path = self.headers.get("X-Audio-Source", "loopback-upload")
                asset = self.ledger.import_stream(self.rfile, length, original_name, source_path=source_path)
                self._json(HTTPStatus.CREATED, asset.__dict__)
            except (ValueError, OSError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_application_json"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
            if self.path == "/ledger/import":
                asset = self.ledger.import_audio(payload["path"], payload.get("sensitivity", "private"))
                self._json(HTTPStatus.CREATED, asset.__dict__)
                return
            if self.path == "/ledger/upload":
                content = base64.b64decode(payload["data_base64"], validate=True)
                asset = self.ledger.import_bytes(content, payload.get("name", "recording.webm"), payload.get("sensitivity", "private"))
                self._json(HTTPStatus.CREATED, asset.__dict__)
                return
            if self.path == "/transcribe":
                provider_name = payload.get("provider", "fixture")
                asset = None
                if "asset_id" in payload:
                    asset = self.ledger.get(payload["asset_id"])
                    source = Path(asset.stored_path).resolve()
                    if source.parent != self.ledger.objects.resolve() or not source.is_file():
                        raise FileNotFoundError("audio asset is unavailable")
                    source_name = asset.original_name
                else:
                    source = Path(payload["path"]).expanduser().resolve()
                    source_name = payload.get("name", source.name)
                if provider_name == "fixture":
                    provider = FixtureProvider()
                elif provider_name == "whisper.cpp":
                    provider = WhisperCppProvider(
                        payload["executable"],
                        payload["model"],
                        payload.get("ffmpeg_executable", "ffmpeg"),
                        source_name,
                    )
                else:
                    raise ValueError(f"unsupported provider: {provider_name}")
                job = self.jobs.submit(source, provider)
                self._json(HTTPStatus.ACCEPTED, job.__dict__)
                return
            if self.path == "/records/from-job":
                job = self.jobs.get(payload["job_id"])
                if job.status != "completed" or not job.transcript_path:
                    raise ValueError(f"transcription job is not complete: {job.status}")
                asset = self.ledger.get(payload["asset_id"])
                source = Path(asset.stored_path).resolve()
                if source.parent != self.ledger.objects.resolve() or not source.is_file():
                    raise FileNotFoundError("audio asset is unavailable")
                if Path(job.source_path).resolve() != source:
                    raise ValueError("job source does not match audio asset")
                title = validate_record_title(payload["title"])
                profile = payload.get("primary_mode", "knowledge")
                if profile not in PROFILES:
                    raise ValueError(f"unknown processing profile: {profile}")
                transcript_path = Path(job.transcript_path).resolve()
                if transcript_path.parent != self.jobs.root.resolve() or not transcript_path.is_file():
                    raise FileNotFoundError("transcription output is unavailable")
                transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
                record = ConversationRecord(
                    id=str(uuid.uuid4()),
                    title=title,
                    created_at=datetime.now().astimezone().isoformat(),
                    audio_path=str(source),
                    primary_mode=profile,
                    audio_asset_id=asset.id,
                    context=payload.get("context", "未指定"),
                    sensitivity=asset.sensitivity,
                    transcript_provider=transcript.get("provider", job.provider),
                    transcript_model=transcript.get("model"),
                    transcript_language=transcript.get("language"),
                    segments=[Segment(**segment) for segment in transcript.get("segments", [])],
                )
                processor_name = payload.get("processor")
                if processor_name == "ollama-local":
                    analysis = LocalOllamaProcessor(
                        payload.get("processor_endpoint", "http://127.0.0.1:11434"),
                        payload.get("processor_model", ""),
                    ).process(record)
                elif processor_name is None:
                    analysis = None
                else:
                    raise ValueError(f"unsupported semantic processor: {processor_name}")
                vault = Path(payload["vault"]).expanduser().resolve()
                destination = vault / "Recordings" / f"{title}.md"
                if destination.exists():
                    raise FileExistsError(f"recording already exists: {destination}")
                destination = write_compiled(record, vault, analysis=analysis)
                sidecar = vault / ".voice-memory" / "recordings" / f"{record.id}.json"
                self._register_record(record.id, sidecar)
                self._json(HTTPStatus.CREATED, {"record_id": record.id, "path": str(destination), "sidecar_path": str(sidecar), "asset_id": asset.id})
                return
            record_data = payload["record"]
            record = ConversationRecord(**{key: value for key, value in record_data.items() if key != "segments"})
            record.segments = [Segment(**segment) for segment in record_data.get("segments", [])]
            with self._record_write_lock:
                destination = write_compiled(record, payload["vault"])
                sidecar = Path(payload["vault"]) / ".voice-memory" / "recordings" / f"{record.id}.json"
                self._register_record(record.id, sidecar)
            self._json(HTTPStatus.CREATED, {"path": str(destination), "sidecar_path": str(sidecar), "record_id": record.id})
        except FileExistsError as error:
            self._json(HTTPStatus.CONFLICT, {"error": str(error)})
        except (KeyError, FileNotFoundError, ValueError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def log_message(self, *_: object) -> None:
        return


def _process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError as error:
        if error.errno == errno.ESRCH or getattr(error, "winerror", None) in {6, 87}:
            return False
        raise
    return True


def serve(root: str, host: str = "127.0.0.1", port: int = 8765, parent_pid: int | None = None) -> None:
    if parent_pid is not None and (parent_pid <= 0 or parent_pid == os.getpid()):
        raise ValueError("parent PID must identify a different live process")
    handler = type(
        "ConfiguredVoiceMemoryHandler",
        (VoiceMemoryHandler,),
        {"ledger": AudioLedger(root), "jobs": JobStore(root), "data_root": Path(root)},
    )
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Voice Memory listening on http://{host}:{port}")
    if parent_pid is None:
        server.serve_forever()
        return

    serving = threading.Thread(target=server.serve_forever, name="voice-memory-http", daemon=True)
    serving.start()

    def watch_parent() -> None:
        while _process_exists(parent_pid):
            time.sleep(0.25)
        print("Voice Memory desktop parent exited; stopping local API")
        server.shutdown()

    threading.Thread(target=watch_parent, name="voice-memory-parent-watch", daemon=True).start()
    serving.join()
    server.server_close()
