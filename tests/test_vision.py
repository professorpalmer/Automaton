from __future__ import annotations

import pytest

from harness.gates import FLOOR_MODEL
from harness.jobs import ImageRecord
from harness.vision import (
    VisionResult,
    VisionUnusable,
    accept_image,
    prepare_for_workhorse,
)


PNG_ONE_PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _FakeSidecar:
    name = "fake-vlm"

    def __init__(self, text: str = "green Submit button, top right", error: str | None = None) -> None:
        self.text = text
        self.error = error
        self.seen: list[str] = []

    def transcribe(self, image_path: str) -> VisionResult:
        self.seen.append(image_path)
        return VisionResult(text=self.text, model=self.name, error=self.error)


def test_accept_image_never_refuses(tmp_path) -> None:
    record = accept_image(
        PNG_ONE_PIXEL,
        filename="paste.png",
        mime="image/png",
        job_id="job-1",
        root=tmp_path,
    )
    assert record.dropped is False
    assert record.bytes == len(PNG_ONE_PIXEL)
    from harness.paths import uploads_dir

    assert (uploads_dir(tmp_path) / "job-1").exists()


def test_text_only_floor_uses_sidecar_not_pixels() -> None:
    record = ImageRecord("1", "/tmp/a.png", "image/png", 10, "now")
    sidecar = _FakeSidecar()
    prepared = prepare_for_workhorse([record], workhorse_model=FLOOR_MODEL, sidecar=sidecar)
    assert prepared.delivery == "sidecar_text"
    assert "Submit" in (prepared.sidecar_text or "")
    assert sidecar.seen == ["/tmp/a.png"]


def test_vision_capable_workhorse_keeps_pixels() -> None:
    record = ImageRecord("1", "/tmp/a.png", "image/png", 10, "now")
    sidecar = _FakeSidecar()
    prepared = prepare_for_workhorse(
        [record],
        workhorse_model="cursor-grok-4.6-high-fast",
        sidecar=sidecar,
    )
    assert prepared.delivery == "native_pixels"
    assert prepared.sidecar_text is None
    assert sidecar.seen == []


def test_failed_sidecar_fails_loud() -> None:
    record = ImageRecord("1", "/tmp/a.png", "image/png", 10, "now")
    sidecar = _FakeSidecar(text="", error="vlm unavailable")
    with pytest.raises(VisionUnusable, match="transcription failed"):
        prepare_for_workhorse([record], workhorse_model=FLOOR_MODEL, sidecar=sidecar)


def test_dropped_flag_is_unusable() -> None:
    record = ImageRecord("1", "/tmp/a.png", "image/png", 10, "now", dropped=True)
    with pytest.raises(VisionUnusable, match="dropped"):
        prepare_for_workhorse([record], workhorse_model=FLOOR_MODEL, sidecar=_FakeSidecar())
