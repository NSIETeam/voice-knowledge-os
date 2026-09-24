import json
import tempfile
import threading
import time
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
import pytest
from voice_memory import api
from voice_memory.api import INDEX_HTML, VoiceMemoryHandler
from voice_memory.cli import demo_record
from voice_memory.ledger import AudioLedger
from voice_memory.models import ConversationRecord, Segment
from voice_memory.processing import transcript_fingerprint
from voice_memory.transcription import Transcript


def test_local_dashboard_is_explicitly_loopback_oriented():
    assert "127.0.0.1" in INDEX_HTML
    assert "不会向局域网暴露录音" in INDEX_HTML


def test_compile_payload_shape_is_json_serializable():
    payload = {"record": {"id": "r1", "title": "demo", "created_at": "now", "audio_path": "a", "primary_mode": "decision", "segments": []}, "vault": "/tmp/vault"}
    assert json.loads(json.dumps(payload))["record"]["id"] == "r1"


def test_transcription_provider_payloads_are_explicit():
    fixture = {"provider": "fixture", "path": "/tmp/recording.webm"}
    whisper = {"provider": "whisper.cpp", "path": "/tmp/recording.webm", "executable": "/opt/whisper-cli", "model": "/models/ggml-base.bin"}
    assert json.loads(json.dumps(fixture))["provider"] == "fixture"
    assert json.loads(json.dumps(whisper))["model"].endswith("ggml-base.bin")


def test_api_rejects_untrusted_browser_origins_and_simple_content_types(tmp_path):
    data_root = tmp_path / "data"
    ledger = AudioLedger(data_root)
    from voice_memory.jobs import JobStore
    handler = type(
        "SecurityTestHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": ledger, "jobs": JobStore(data_root)},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        upload = urllib.request.Request(
            f"{base}/ledger/upload",
            data=b"must not enter the ledger",
            headers={
                "Content-Type": "application/octet-stream",
                "X-File-Name": "attack.webm",
                "Origin": "https://untrusted.example",
            },
            method="POST",
        )
        try:
            urllib.request.urlopen(upload)
            raise AssertionError("untrusted origin unexpectedly reached the upload route")
        except urllib.error.HTTPError as error:
            assert error.code == 403
            assert json.load(error)["error"] == "untrusted_origin"
        assert not list(ledger.objects.rglob("*"))

        simple_post = urllib.request.Request(
            f"{base}/records/compile",
            data=b'{"record":{}}',
            headers={"Content-Type": "text/plain", "Origin": "http://tauri.localhost"},
            method="POST",
        )
        try:
            urllib.request.urlopen(simple_post)
            raise AssertionError("simple content type unexpectedly reached the JSON route")
        except urllib.error.HTTPError as error:
            assert error.code == 415
            assert json.load(error)["error"] == "content_type_must_be_application_json"
    finally:
        server.shutdown()


def test_ledger_audio_supports_trusted_obsidian_range_requests(tmp_path):
    from voice_memory.jobs import JobStore

    data_root = tmp_path / "data"
    handler = type(
        "ObsidianAudioHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": AudioLedger(data_root), "jobs": JobStore(data_root)},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        upload = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/ledger/upload",
            data=b"range-audio",
            headers={"Content-Type": "application/octet-stream", "X-File-Name": "test.wav"},
            method="POST",
        )
        asset = json.load(urllib.request.urlopen(upload))
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/ledger/{asset['id']}/content",
            headers={"Origin": "app://obsidian.md", "Range": "bytes=0-3"},
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 206
            assert response.read() == b"rang"
            assert response.headers["Access-Control-Allow-Origin"] == "app://obsidian.md"
            assert response.headers["Content-Range"] == f"bytes 0-3/{len(b'range-audio')}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize(
    ("field", "value"),
    [("title", "../../../outside"), ("id", "../../../outside")],
)
def test_compile_api_rejects_path_components_before_writing(tmp_path, field, value):
    data_root = tmp_path / "data"
    handler = type(
        "CompilePathTestHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": AudioLedger(data_root)},
    )
    from voice_memory.jobs import JobStore
    handler.jobs = JobStore(data_root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    vault = tmp_path / "vault"
    record = demo_record().to_dict()
    record[field] = value
    request = urllib.request.Request(
        f"http://127.0.0.1:{server.server_port}/records/compile",
        data=json.dumps({"record": record, "vault": str(vault)}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with pytest.raises(urllib.error.HTTPError) as response:
            urllib.request.urlopen(request)
        assert response.value.code == 400
        assert not vault.exists()
        assert not (tmp_path / "outside.md").exists()
    finally:
        server.shutdown()
        server.server_close()


def test_tauri_audio_upload_preflight_allows_source_header(tmp_path):
    from voice_memory.jobs import JobStore

    data_root = tmp_path / "preflight-data"
    handler = type(
        "PreflightHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": AudioLedger(data_root), "jobs": JobStore(data_root)},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    request = urllib.request.Request(
        f"http://127.0.0.1:{server.server_port}/ledger/upload",
        headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-file-name,x-audio-source",
        },
        method="OPTIONS",
    )
    try:
        with urllib.request.urlopen(request) as response:
            allowed = {value.strip().lower() for value in response.headers["Access-Control-Allow-Headers"].split(",")}
            assert response.status == 204
            assert {"content-type", "x-file-name", "x-audio-source"} <= allowed
    finally:
        server.shutdown()
        server.server_close()


def test_uploaded_audio_can_be_transcribed_and_compiled_from_job(tmp_path, monkeypatch):
    class StubProvider:
        name = "fixture"

        def transcribe(self, _audio_path):
            return Transcript("fixture", "fixture-v1", "zh", [Segment("seg-1", 0, 1.2, "Unknown", "本地转写内容")])

    monkeypatch.setattr(api, "FixtureProvider", StubProvider)
    data_root = tmp_path / "data"
    ledger = AudioLedger(data_root)
    handler = type(
        "ConfiguredTestHandler",
        (VoiceMemoryHandler,),
        {"data_root": data_root, "ledger": ledger},
    )
    from voice_memory.jobs import JobStore
    handler.jobs = JobStore(data_root)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        upload_request = urllib.request.Request(
            f"{base}/ledger/upload",
            data=b"fixture audio bytes",
            headers={
                "Content-Type": "application/octet-stream",
                "X-File-Name": "sample.webm",
                "X-Audio-Source": "system-audio-loopback",
            },
            method="POST",
        )
        with urllib.request.urlopen(upload_request) as response:
            assert response.status == 201
            asset = json.load(response)
        assert asset["source_path"] == "system-audio-loopback"
        transcription_request = urllib.request.Request(
            f"{base}/transcribe",
            data=json.dumps({"asset_id": asset["id"], "provider": "fixture"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(transcription_request) as response:
            assert response.status == 202
            job = json.load(response)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = json.load(urllib.request.urlopen(f"{base}/jobs/{job['id']}"))
            if current["status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)
        assert current["status"] == "completed"

        compile_request = urllib.request.Request(
            f"{base}/records/from-job",
            data=json.dumps({
                "job_id": job["id"], "asset_id": asset["id"], "title": "本地测试记录",
                "primary_mode": "knowledge", "vault": str(tmp_path / "vault"),
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(compile_request) as response:
            assert response.status == 201
            compiled = json.load(response)
        markdown = Path(compiled["path"]).read_text(encoding="utf-8")
        assert "本地转写内容" in markdown
        record = json.load(urllib.request.urlopen(f"{base}/records/{compiled['record_id']}"))
        assert record["record"]["audio_asset_id"] == asset["id"]
        correction_request = urllib.request.Request(
            f"{base}/records/{compiled['record_id']}/corrections",
            data=json.dumps({"type":"edit_text", "segment_id":"seg-1", "text":"人工复核内容"}).encode(),
            headers={"Content-Type":"application/json"},
            method="POST",
        )
        correction = json.load(urllib.request.urlopen(correction_request))
        assert correction["record"]["segments"][0]["text"] == "人工复核内容"
        assert len(correction["correction_history"]) == 1

        class StubSemanticProcessor:
            def __init__(self, endpoint, model):
                assert endpoint == "http://127.0.0.1:11434"
                assert model == "fixture-model"

            def process(self, record):
                finding_kind = "actions" if record.primary_mode == "decision" else "concepts"
                return {
                    "schema_version": "voice-memory.analysis.v1",
                    "provider": "ollama-local",
                    "model": "fixture-model",
                    "profile": record.primary_mode,
                    "source_transcript_sha256": transcript_fingerprint(record),
                    "generated_at": "2026-09-17T00:00:00+00:00",
                    "summary": {"text": "有证据支持的本机候选总结", "evidence_ids": ["seg-1"]},
                    "findings": [{"kind": finding_kind, "text": "一个可核验概念", "evidence_ids": ["seg-1"]}],
                }

        monkeypatch.setattr(api, "LocalOllamaProcessor", StubSemanticProcessor)
        semantic_payload = {
            "job_id": job["id"], "asset_id": asset["id"], "title": "语义模型记录",
            "primary_mode": "knowledge", "vault": str(tmp_path / "vault"),
            "processor": "ollama-local", "processor_endpoint": "http://127.0.0.1:11434",
            "processor_model": "fixture-model",
        }
        semantic_request = urllib.request.Request(
            f"{base}/records/from-job",
            data=json.dumps(semantic_payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(semantic_request) as response:
            semantic_record = json.load(response)
        semantic_markdown = Path(semantic_record["path"]).read_text(encoding="utf-8")
        assert "本机模型整理建议（待审核）" in semantic_markdown
        assert "有证据支持的本机候选总结" in semantic_markdown
        assert "[[语义模型记录#^seg-1|原文 00:00]]" in semantic_markdown

        semantic_sidecar = json.load(urllib.request.urlopen(f"{base}/records/{semantic_record['record_id']}"))
        assert semantic_sidecar["analysis"]["model"] == "fixture-model"
        assert semantic_sidecar["analysis_views_current"]["knowledge"] is True
        semantic_correction_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/corrections",
            data=json.dumps({"type": "edit_text", "segment_id": "seg-1", "text": "语义记录的人工校正"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(semantic_correction_request).close()
        semantic_markdown = Path(semantic_record["path"]).read_text(encoding="utf-8")
        assert "语义记录的人工校正" in semantic_markdown
        assert "本机模型整理建议（已过期）" in semantic_markdown
        assert "有证据支持的本机候选总结" not in semantic_markdown
        corrected_sidecar = json.load(urllib.request.urlopen(f"{base}/records/{semantic_record['record_id']}"))
        assert corrected_sidecar["analysis"]["summary"]["text"] == "有证据支持的本机候选总结"
        assert corrected_sidecar["analysis_views_current"]["knowledge"] is False
        reprocess_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess",
            data=json.dumps({
                "primary_mode": "decision", "processor_endpoint": "http://127.0.0.1:11434",
                "processor_model": "fixture-model",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(reprocess_request) as response:
                preview = json.load(response)
        except urllib.error.HTTPError as error:
            pytest.fail(f"reprocess preview failed: {error.read().decode()}")
        assert preview["approval_required"] is True
        assert len(preview["files"]) == 2
        assert "有证据支持的本机候选总结" in "".join(item["diff"] for item in preview["files"])
        cancel_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/cancel",
            data=json.dumps({"preview_id": preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        json.load(urllib.request.urlopen(cancel_request))
        cancelled_approval = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/approve",
            data=json.dumps({"preview_id": preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as cancelled:
            urllib.request.urlopen(cancelled_approval)
        assert cancelled.value.code == 410
        reprocess_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess",
            data=json.dumps({
                "primary_mode": "decision", "processor_endpoint": "http://127.0.0.1:11434",
                "processor_model": "fixture-model",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        preview = json.load(urllib.request.urlopen(reprocess_request))
        semantic_sidecar = json.load(urllib.request.urlopen(f"{base}/records/{semantic_record['record_id']}"))
        assert semantic_sidecar["record"]["primary_mode"] == "knowledge"
        assert set(semantic_sidecar["analysis_views"]) == {"knowledge"}
        assert len(semantic_sidecar["correction_history"]) == 1
        refreshed_markdown = Path(semantic_record["path"]).read_text(encoding="utf-8")
        assert "本机模型整理建议（已过期）" in refreshed_markdown

        decision_path = Path(semantic_record["path"]).parent / "Views" / semantic_record["record_id"] / "decision.md"
        decision_path.parent.mkdir(parents=True, exist_ok=True)
        decision_path.write_text("# 用户在预览后补充的内容\n", encoding="utf-8")
        approval_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/approve",
            data=json.dumps({"preview_id": preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as stale_note:
            urllib.request.urlopen(approval_request)
        assert stale_note.value.code == 409
        assert set(json.load(urllib.request.urlopen(f"{base}/records/{semantic_record['record_id']}"))["analysis_views"]) == {"knowledge"}
        decision_path.unlink()

        stale_record_preview = json.load(urllib.request.urlopen(reprocess_request))
        change_after_preview = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/corrections",
            data=json.dumps({"type": "edit_text", "segment_id": "seg-1", "text": "预览之后再次校正"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(change_after_preview).close()
        stale_record_approval = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/approve",
            data=json.dumps({"preview_id": stale_record_preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as stale_record_error:
            urllib.request.urlopen(stale_record_approval)
        assert stale_record_error.value.code == 409

        reprocess_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess",
            data=json.dumps({
                "primary_mode": "decision", "processor_endpoint": "http://127.0.0.1:11434",
                "processor_model": "fixture-model",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        preview = json.load(urllib.request.urlopen(reprocess_request))
        approval_request = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/approve",
            data=json.dumps({"preview_id": preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(approval_request) as response:
            reprocessed = json.load(response)
        rollback_dir = Path(semantic_record["path"]).parent.parent / ".voice-memory" / "rollback" / semantic_record["record_id"]
        rollback_count = len(list(rollback_dir.glob("*.md")))
        retry_approval = urllib.request.Request(
            f"{base}/records/{semantic_record['record_id']}/reprocess/approve",
            data=json.dumps({"preview_id": preview["preview_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        assert json.load(urllib.request.urlopen(retry_approval)) == reprocessed
        assert len(list(rollback_dir.glob("*.md"))) == rollback_count
        assert reprocessed["analysis"]["profile"] == "decision"
        assert reprocessed["analysis"]["source_transcript_sha256"] == transcript_fingerprint(
            ConversationRecord(
                **{key: value for key, value in reprocessed["record"].items() if key != "segments"},
                segments=[Segment(**segment) for segment in reprocessed["record"]["segments"]],
            )
        )
        semantic_sidecar = json.load(urllib.request.urlopen(f"{base}/records/{semantic_record['record_id']}"))
        assert semantic_sidecar["record"]["primary_mode"] == "knowledge"
        assert set(semantic_sidecar["analysis_views"]) == {"knowledge", "decision"}
        assert len(semantic_sidecar["correction_history"]) == 2
        decision_view = Path(reprocessed["view_path"]).read_text(encoding="utf-8")
        assert "本机模型整理建议（待审核）" in decision_view
        assert "有证据支持的本机候选总结" in decision_view
    finally:
        server.shutdown()
