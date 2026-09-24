from voice_memory.api import VoiceMemoryHandler
from http.server import ThreadingHTTPServer
import threading
import urllib.request

from voice_memory.jobs import JobStore
from voice_memory.ledger import AudioLedger


def test_api_declares_preflight_contract():
    assert "http://tauri.localhost" in VoiceMemoryHandler.allowed_origins
    assert "app://obsidian.md" in VoiceMemoryHandler.allowed_origins
    assert "*" not in VoiceMemoryHandler.allowed_origins
    assert 204 in VoiceMemoryHandler.do_OPTIONS.__code__.co_consts
    assert {"Content-Type", "X-File-Name", "X-Audio-Source"} <= set(VoiceMemoryHandler.allowed_headers)


def test_obsidian_desktop_origin_can_read_local_api(tmp_path):
    handler = type(
        "ObsidianOriginHandler",
        (VoiceMemoryHandler,),
        {"data_root": tmp_path, "ledger": AudioLedger(tmp_path), "jobs": JobStore(tmp_path)},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/health",
            headers={"Origin": "app://obsidian.md"},
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
            assert response.headers["Access-Control-Allow-Origin"] == "app://obsidian.md"
    finally:
        server.shutdown()
        server.server_close()
