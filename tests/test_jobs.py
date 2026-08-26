from __future__ import annotations

import pytest

from harness.gates import PHASE_STEER, STATUS_REPORT_BACK
from harness.jobs import ImageRecord, JobError, JobStore, Receipt


def test_full_auto_waves_then_steer(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("Build a waitlist upload page")
    store.start_full_auto(job, ["spec", "ship", "verify"])
    store.begin_wave(job, "spec")
    store.pass_wave(job, "spec", "title=Waitlist upload")
    store.begin_wave(job, "ship")
    store.pass_wave(job, "ship", "wrote index.html")
    store.begin_wave(job, "verify")
    store.pass_wave(job, "verify", "button present")
    store.report_back(job, "Ready. Open the product and tell me what to change.", "tenant/soldiers-angels/products/x/index.html")
    reloaded = store.get(job.id)
    assert reloaded.status == STATUS_REPORT_BACK
    assert reloaded.phase == PHASE_STEER
    store.begin_steer(reloaded)
    assert store.get(job.id).status == "steering"


def test_cannot_report_back_with_a_failed_wave(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("broken")
    store.start_full_auto(job, ["spec"])
    store.begin_wave(job, "spec")
    store.fail_wave(job, "spec", "no brief")
    with pytest.raises(JobError, match="report back"):
        store.report_back(job, "done", "")


def test_images_never_dropped(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("with shot")
    record = ImageRecord(
        id="img1",
        path="x.png",
        mime="image/png",
        bytes=12,
        accepted_at="now",
        dropped=False,
    )
    store.accept_image(job, record)
    assert len(store.get(job.id).images) == 1
    with pytest.raises(JobError, match="dropped"):
        store.accept_image(job, ImageRecord("x", "x", "image/png", 1, "now", dropped=True))


def test_unknown_receipt_is_not_zero(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("cost")
    store.add_receipt(job, Receipt(source="unknown", model="deepseek/deepseek-v4-flash", cost_usd=None))
    assert store.get(job.id).receipts[0].cost_usd is None


def test_maker_checker_store_path(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("tool")
    with pytest.raises(JobError, match="maker"):
        store.maker_check(job)
    store.mark_ready_for_check(job)
    assert store.get(job.id).is_official() is False
    store.maker_check(job)
    assert store.get(job.id).is_official() is True


def test_playbook_stays_unofficial_until_checker(tmp_path) -> None:
    store = JobStore(tmp_path)
    job = store.create("tool")
    assert job.is_official() is False
    job.official_playbook = True
    assert job.is_official() is False
    job.maker_checked = True
    assert job.is_official() is True
