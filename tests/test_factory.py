from __future__ import annotations

from html import escape

from harness.factory import parse_spec, render_tool
from harness.gates import TENANT_DISPLAY


def test_parse_waitlist_brief() -> None:
    spec = parse_spec("Build a waitlist upload page with a Submit button")
    assert spec.title.lower().startswith("waitlist")
    assert spec.primary_action == "Submit"
    assert spec.fields


def test_render_includes_sa_brand_and_action() -> None:
    spec = parse_spec("Make a box-request form with a Submit button")
    html = render_tool(spec)
    assert escape(TENANT_DISPLAY) in html
    assert "Submit" in html
    assert "--accent:" in html
