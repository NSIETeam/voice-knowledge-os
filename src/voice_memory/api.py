from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .ledger import AudioLedger
from .models import PROFILES


class VoiceMemoryHandler(BaseHTTPRequestHandler):
    ledger: AudioLedger

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "service": "voice-memory"})
        elif self.path == "/profiles":
            self._json(HTTPStatus.OK, PROFILES)
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ledger/import":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
            asset = self.ledger.import_audio(payload["path"], payload.get("sensitivity", "private"))
            self._json(HTTPStatus.CREATED, asset.__dict__)
        except (KeyError, FileNotFoundError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def log_message(self, *_: object) -> None:
        return


def serve(root: str, host: str = "127.0.0.1", port: int = 8765) -> None:
    handler = type("ConfiguredVoiceMemoryHandler", (VoiceMemoryHandler,), {"ledger": AudioLedger(root)})
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Voice Memory listening on http://{host}:{port}")
    server.serve_forever()

