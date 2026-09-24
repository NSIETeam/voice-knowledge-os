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
    assert ".evidence-link" in styles
    assert 'src="/assets/miraphant.svg"' in html
    assert 'fill="#1B3D32"' in brand_mark
