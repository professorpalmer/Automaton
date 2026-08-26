from __future__ import annotations

import pytest

from harness.loop import run_full_auto, run_steer
from harness.paths import products_dir
from harness.rewind import RewindError, can_undo, run_undo


def test_steer_then_undo_restores_the_shipped_tool(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    product = products_dir(tmp_path) / job.id / "index.html"
    shipped = product.read_text(encoding="utf-8")
    assert can_undo(job, tmp_path) is False
    steered = run_steer(job.id, "turn that button gold", root=tmp_path)
    assert can_undo(steered, tmp_path) is True
    assert "--accent: #c4a35a" in product.read_text(encoding="utf-8")
    undone = run_undo(job.id, root=tmp_path)
    assert product.read_text(encoding="utf-8") == shipped
    assert undone.report == "Put it back."
    assert can_undo(undone, tmp_path) is False


def test_second_undo_walks_back_one_steer(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    product = products_dir(tmp_path) / job.id / "index.html"
    run_steer(job.id, "turn that button gold", root=tmp_path)
    gold = product.read_text(encoding="utf-8")
    run_steer(job.id, "turn that button blue", root=tmp_path)
    assert "--accent: #4472c4" in product.read_text(encoding="utf-8")
    run_undo(job.id, root=tmp_path)
    assert product.read_text(encoding="utf-8") == gold


def test_official_playbook_locks_undo(tmp_path) -> None:
    from harness.jobs import JobStore

    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    run_steer(job.id, "turn that button gold", root=tmp_path)
    store = JobStore(tmp_path)
    locked = store.get(job.id)
    store.mark_ready_for_check(locked)
    store.maker_check(locked)
    locked = store.get(job.id)
    assert locked.is_official() is True
    assert can_undo(locked, tmp_path) is False
    with pytest.raises(RewindError, match="locked"):
        run_undo(job.id, root=tmp_path)
