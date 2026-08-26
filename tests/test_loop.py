from __future__ import annotations

import pytest

from harness.loop import ScriptedSidecar, run_full_auto, run_steer
from harness.paths import catalog_dir, products_dir
from harness.vision import VisionUnusable

PNG_ONE_PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_full_auto_then_color_steer(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    assert job.status == "report_back"
    assert job.phase == "steer"
    assert job.title.lower().startswith("waitlist")
    product = products_dir(tmp_path) / job.id / "index.html"
    assert product.is_file()
    assert "Submit" in product.read_text(encoding="utf-8")
    wiki = catalog_dir(tmp_path) / "jobs" / f"{job.id}.json"
    assert wiki.is_file()
    steered = run_steer(job.id, "turn that button blue", root=tmp_path)
    assert "--accent: #4472c4" in product.read_text(encoding="utf-8")
    assert "Changed:" in steered.report


def test_screenshot_is_kept_and_sidecar_text_reaches_spec(tmp_path) -> None:
    job = run_full_auto(
        "Build the page in this screenshot with a Submit button",
        [(PNG_ONE_PIXEL, "shot.png", "image/png")],
        root=tmp_path,
        sidecar=ScriptedSidecar("big green Submit in the header"),
    )
    assert job.images and job.images[0].dropped is False
    html = (products_dir(tmp_path) / job.id / "index.html").read_text(encoding="utf-8")
    assert "big green Submit" in html


def test_failed_sidecar_fails_loud(tmp_path) -> None:
    with pytest.raises(VisionUnusable):
        run_full_auto(
            "Build this",
            [(PNG_ONE_PIXEL, "shot.png", "image/png")],
            root=tmp_path,
            sidecar=ScriptedSidecar("", error="no tenant key"),
        )
