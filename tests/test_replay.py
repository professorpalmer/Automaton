from __future__ import annotations

from harness.loop import run_full_auto
from harness.paths import catalog_dir, products_dir
from harness.receipts import job_spend_usd
from harness.replay import fingerprint


def test_second_identical_job_bills_zero(tmp_path) -> None:
    first = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    assert first.status == "report_back"
    assert first.replay_key
    assert job_spend_usd(first.receipts) == 0.0
    second = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    assert second.id != first.id
    assert second.replay_key == first.replay_key
    assert second.status == "report_back"
    assert any(row.source == "cache" and row.cost_usd == 0.0 for row in second.receipts)
    assert job_spend_usd(second.receipts) == 0.0
    assert "billed $0" in second.report
    product = products_dir(tmp_path) / second.id / "index.html"
    assert product.is_file()
    wiki = catalog_dir(tmp_path) / "jobs" / f"{second.id}.json"
    assert wiki.is_file()
    assert first.id in wiki.read_text(encoding="utf-8")
    graph = (catalog_dir(tmp_path) / "graph.json").read_text(encoding="utf-8")
    assert first.id in graph
    assert f"job:{first.id}" in graph


def test_different_brief_does_not_reuse(tmp_path) -> None:
    run_full_auto("Build a waitlist upload page with a Submit button", root=tmp_path)
    other = run_full_auto("Build a gold donation form with an Export button", root=tmp_path)
    assert not any(row.source == "cache" for row in other.receipts)
    assert fingerprint("a", None) != fingerprint("b", None)


def test_wiki_omits_brief_and_report(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    text = (catalog_dir(tmp_path) / "jobs" / f"{job.id}.json").read_text(encoding="utf-8")
    assert "brief" not in text.lower()
    assert "report" not in text.lower()
    assert "Build a waitlist" not in text


def test_second_service_job_reuses(tmp_path) -> None:
    brief = (
        "Transportation reconciliation: match Lyft to FormAssembly "
        "from an xlsx workbook and export exceptions"
    )
    first = run_full_auto(brief, root=tmp_path)
    second = run_full_auto(brief, root=tmp_path)
    assert any(row.source == "cache" and row.cost_usd == 0.0 for row in second.receipts)
    assert (products_dir(tmp_path) / second.id / "app.py").is_file()
    assert first.id in (catalog_dir(tmp_path) / "jobs" / f"{second.id}.json").read_text(
        encoding="utf-8"
    )
