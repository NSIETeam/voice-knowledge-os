from __future__ import annotations

import json
from urllib.parse import unquote
import base64
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .ledger import AudioLedger
from .compiler import write_compiled
from .jobs import JobStore
from .models import ConversationRecord, PROFILES, Segment
from .transcription import FixtureProvider, WhisperCppProvider
from .review import apply_correction, load_sidecar


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
    allowed_origins = {"http://tauri.localhost", "tauri://localhost", "http://127.0.0.1:8765", "http://localhost:8765"}

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in self.allowed_origins else None

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/":
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
                _, sidecar = load_sidecar(self.data_root, record_id)
                self._json(HTTPStatus.OK, sidecar)
            except FileNotFoundError:
                self._json(HTTPStatus.NOT_FOUND, {"error": "record_not_found"})
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/records/") and self.path.endswith("/corrections"):
            record_id = unquote(self.path.removeprefix("/records/").removesuffix("/corrections")).strip()
            length = int(self.headers.get("Content-Length", "0"))
            try:
                payload = json.loads(self.rfile.read(length))
                result = apply_correction(self.data_root, record_id, payload)
                self._json(HTTPStatus.OK, result)
            except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if self.path not in ("/ledger/import", "/ledger/upload", "/records/compile", "/transcribe"):
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
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
                if provider_name == "fixture":
                    provider = FixtureProvider()
                elif provider_name == "whisper.cpp":
                    provider = WhisperCppProvider(payload["executable"], payload["model"])
                else:
                    raise ValueError(f"unsupported provider: {provider_name}")
                job = self.jobs.transcribe(payload["path"], provider)
                self._json(HTTPStatus.CREATED, job.__dict__)
                return
            record_data = payload["record"]
            record = ConversationRecord(**{key: value for key, value in record_data.items() if key != "segments"})
            record.segments = [Segment(**segment) for segment in record_data.get("segments", [])]
            destination = write_compiled(record, payload["vault"])
            sidecar = Path(payload["vault"]) / ".voice-memory" / "recordings" / f"{record.id}.json"
            self._json(HTTPStatus.CREATED, {"path": str(destination), "sidecar_path": str(sidecar), "record_id": record.id})
        except (KeyError, FileNotFoundError, ValueError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def log_message(self, *_: object) -> None:
        return


def serve(root: str, host: str = "127.0.0.1", port: int = 8765) -> None:
    handler = type(
        "ConfiguredVoiceMemoryHandler",
        (VoiceMemoryHandler,),
        {"ledger": AudioLedger(root), "jobs": JobStore(root), "data_root": Path(root)},
    )
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Voice Memory listening on http://{host}:{port}")
    server.serve_forever()
