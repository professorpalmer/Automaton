from __future__ import annotations

import json

import pytest

from harness.steer import SteerError, apply_steer
from harness.vault import write_tenant_openrouter_key
from harness.workhorse import WorkhorseError, rewrite_html
from harness.loop import run_full_auto, run_steer


HTML = """<!DOCTYPE html><html><body>
<p class="brand">Soldiers&#x27; Angels</p>
<h1>Waitlist</h1>
<button class="primary" type="submit">Submit</button>
</body></html>"""


def _opener(_request):
    body = {
        "choices": [
            {
                "message": {
                    "content": HTML.replace("<h1>Waitlist</h1>", "<h1>Waitlist — reviewed</h1>")
                }
            }
        ]
    }
    return json.dumps(body).encode("utf-8")


def test_rewrite_requires_tenant_key(tmp_path) -> None:
    with pytest.raises(WorkhorseError, match="tenant"):
        rewrite_html(HTML, "add a reviewed note", root=tmp_path)


def test_rewrite_keeps_brand(tmp_path) -> None:
    write_tenant_openrouter_key("sk-or-v1-test", tmp_path)
    out = rewrite_html(HTML, "add reviewed to the title", root=tmp_path, opener=_opener)
    assert "reviewed" in out
    assert "Soldiers" in out


def test_richer_steer_uses_workhorse_when_key_present(tmp_path) -> None:
    write_tenant_openrouter_key("sk-or-v1-test", tmp_path)
    job = run_full_auto("Build a waitlist upload page with a Submit button", root=tmp_path)
    steered = run_steer(
        job.id,
        "add a reviewed note to the heading",
        root=tmp_path,
        opener=_opener,
    )
    from harness.paths import products_dir

    html = (products_dir(tmp_path) / job.id / "index.html").read_text(encoding="utf-8")
    assert "reviewed" in html
    assert "workhorse=" in steered.report


def test_richer_steer_without_key_stays_honest(tmp_path) -> None:
    job = run_full_auto("Build a waitlist upload page with a Submit button", root=tmp_path)
    with pytest.raises(SteerError, match="green"):
        run_steer(job.id, "make it feel more playful", root=tmp_path)
