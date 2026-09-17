import re
from pathlib import Path


def test_desktop_javascript_static_selectors_exist_in_html():
    root = Path(__file__).resolve().parents[1]
    html = (root / "desktop/src/index.html").read_text(encoding="utf-8")
    javascript = (root / "desktop/src/main.js").read_text(encoding="utf-8")
    html_ids = set(re.findall(r'\bid="([^"]+)"', html))
    selected_ids = set(re.findall(r"querySelector\('#([^']+)'\)", javascript))

    assert selected_ids <= html_ids, f"missing desktop controls: {sorted(selected_ids - html_ids)}"
