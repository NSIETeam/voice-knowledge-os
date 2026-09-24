import re
from pathlib import Path


def test_desktop_javascript_static_selectors_exist_in_html():
    root = Path(__file__).resolve().parents[1]
    html = (root / "desktop/src/index.html").read_text(encoding="utf-8")
    javascript = (root / "desktop/src/main.js").read_text(encoding="utf-8")
    styles = (root / "desktop/src/styles.css").read_text(encoding="utf-8")
    brand_mark = (root / "desktop/src/assets/miraphant.svg").read_text(encoding="utf-8")
    html_ids = set(re.findall(r'\bid="([^"]+)"', html))
    selected_ids = set(re.findall(r"querySelector\('#([^']+)'\)", javascript))

    assert selected_ids <= html_ids, f"missing desktop controls: {sorted(selected_ids - html_ids)}"
    assert re.search(r"\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important", styles)
    assert "analysis_views_current" in javascript
    assert "jumpToEvidence" in javascript
    assert "reviewAssertionsList" in html
    assert 'id="library"' in html and 'id="recordList"' in html
    assert "refreshRecentRecords" in javascript and "${apiUrl}/records" in javascript
    assert 'id="reprocessDialog"' in html and 'id="approveReprocess"' in html
    assert "reprocess/approve" in javascript and "reprocess/cancel" in javascript
    assert ".evidence-link" in styles
    assert 'src="/assets/miraphant.svg"' in html
    assert 'fill="#1B3D32"' in brand_mark
    assert 'id="diarizationPath"' in html and 'id="diarizationModel"' in html
    assert "diarization_executable" in javascript and "diarization_model" in javascript
    assert ".brand-mark" in styles and "#1b3d32" in styles.lower()
    assert "@media (max-width: 860px)" in styles and "@media (max-width: 600px)" in styles
    assert "@import" not in styles, "desktop UI must not fetch remote styles or fonts"
    assert "automatic model downloads are disabled" in (root / "src/voice_memory/transcription.py").read_text(encoding="utf-8")
    assert "参与此片段的说话人 ID，逗号分隔" in javascript
    assert "type:'set_speakers'" in javascript


def test_obsidian_plugin_contract_is_local_and_evidence_linked():
    root = Path(__file__).resolve().parents[1]
    plugin = root / "obsidian-plugin"
    main = (plugin / "main.js").read_text(encoding="utf-8")
    loopback = (plugin / "loopback.js").read_text(encoding="utf-8")
    manifest = (plugin / "manifest.json").read_text(encoding="utf-8")
    styles = (plugin / "styles.css").read_text(encoding="utf-8")
    assert '"isDesktopOnly": true' in manifest
    assert "require('./loopback')" in main
    assert "http:" in loopback and "ALLOWED_HOSTS" in loopback
    assert "127.0.0.1" in main
    assert "requestUrl" in main
    assert "speaker_status: 'confirmed'" in main
    assert "reprocess" in main and "reprocess/approve" in main
    assert "ReprocessApprovalModal" in main and "暂不写入" in main
    assert "audio_asset_id" in main and "jump(segment)" in main
    assert ".vm-analysis" in styles and ".vm-evidence-link" in styles
