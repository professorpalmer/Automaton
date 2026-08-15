from __future__ import annotations

import time

from face.app import create_app
from fastapi.testclient import TestClient
from harness.intake import (
    YES,
    ask_text,
    have_kinds,
    have_need,
    intake_bubbles,
    kind_of,
    needs_for,
    operator_said_go,
    ready_to_build,
)
from harness.jobs import JobStore
from harness.loop import ScriptedSidecar, continue_intake, open_request
from harness.reply_first import ack_for, legal_first


def _wait_store(root, job_id: str, timeout: float = 20.0):
    deadline = time.time() + timeout
    current = JobStore(root).get(job_id)
    while time.time() < deadline:
        current = JobStore(root).get(job_id)
        if current.status in ("report_back", "failed", "done"):
            return current
        time.sleep(0.1)
    raise AssertionError("build did not finish: " + current.status)


def test_website_ask_waits_for_a_drop_or_go() -> None:
    brief = "We need a website built that does all of these things."
    needs = needs_for(brief)
    assert ready_to_build(needs, set(), brief) is False
    bubbles = intake_bubbles(brief, needs, set(), first=True)
    assert bubbles[0] == YES
    assert bubbles[1] == "We will need some things from you before we can finish, though."
    assert "Drag it here" in bubbles[2]
    assert legal_first(ack_for("intake"), "ack")


def test_recon_names_the_workbook_and_refuses_login() -> None:
    brief = "Reconcile Lyft to FormAssembly and export the exception queue."
    needs = needs_for(brief)
    assert needs[0]["kind"] == "workbook"
    assert ready_to_build(needs, set(), brief) is False
    ask = ask_text(brief, needs, set())
    assert "workbook" in ask
    assert "cannot log in" in ask
    assert ready_to_build(needs, {"workbook"}, brief) is True
    assert operator_said_go("that's all I have") is True
    assert ready_to_build(needs, set(), "go ahead") is True


def test_kind_of_files() -> None:
    assert kind_of("month.xlsx") == "workbook"
    assert kind_of("rides.csv") == "workbook"
    assert kind_of("shot.png", "image/png") == "image"
    assert kind_of("letter.pdf") == "document"
    assert have_kinds(["month.xlsx", "shot.png"]) == {"workbook", "image"}


def test_open_request_asks_then_continue_ships(tmp_path) -> None:
    job = open_request(
        "We need a website built that does all of these things.",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert job.product_relpath == ""
    assert "I've got someone working on that." in job.report
    assert "screenshot" in job.report.lower()
    assert "available here" not in job.report
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    shipped = continue_intake(
        job.id,
        "",
        [(png, "page.png", "image/png")],
        root=tmp_path,
        sidecar=ScriptedSidecar("a waitlist page"),
    )
    assert shipped.status == "report_back"
    assert shipped.product_relpath
    assert "available here" in shipped.report


def test_workbook_drop_unblocks_recon(tmp_path) -> None:
    job = open_request(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert "workbook" in job.report
    shipped = continue_intake(
        job.id,
        "",
        [(b"id,status\n1,Ride\n", "month.csv", "text/csv")],
        root=tmp_path,
    )
    assert shipped.status == "report_back"
    assert any(record.kind == "workbook" for record in shipped.files)
    from harness.paths import products_dir

    kept = products_dir(tmp_path) / shipped.id / "intake.csv"
    assert kept.is_file()
    assert "kept the workbook" in shipped.report
    client = TestClient(create_app(tmp_path))
    page = client.get(f"/product/{shipped.id}/")
    assert page.status_code == 200
    assert "already have" in page.text
    ran = client.post(f"/product/{shipped.id}/run-kept")
    assert ran.status_code == 200, ran.text


def test_keeps_asking_until_ready(tmp_path) -> None:
    job = open_request(
        "Reconcile Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    first = continue_intake(job.id, "we also want the VA letters later", root=tmp_path)
    assert first.status == "intake"
    assert first.ask_round >= 1
    second = continue_intake(job.id, "not sure which columns yet", root=tmp_path)
    assert second.status == "intake"
    assert second.ask_round >= 2
    assert "workbook" in second.report.lower()


def test_named_files_are_asked_one_at_a_time(tmp_path) -> None:
    job = open_request(
        "Match lyft.csv to fa.xlsx and export the exception queue",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert "lyft.csv" in job.report
    mid = continue_intake(
        job.id,
        "",
        [(b"id,status\n1,Ride\n", "lyft.csv", "text/csv")],
        root=tmp_path,
    )
    assert mid.status == "intake"
    assert "fa.xlsx" in mid.report
    shipped = continue_intake(
        job.id,
        "",
        [(b"id,name\n1,Ann\n", "fa.xlsx", "text/csv")],
        root=tmp_path,
    )
    assert shipped.status == "report_back"
    assert "available here" in shipped.report


def test_go_ahead_still_asks_after_the_product_is_live(tmp_path) -> None:
    job = open_request(
        "Reconcile Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert "available here" not in job.report
    shipped = continue_intake(job.id, "go ahead", root=tmp_path)
    assert shipped.status == "report_back"
    assert "available here at /product/" in shipped.report
    assert "still need" in shipped.report
    assert "this month's workbook" in shipped.report
    filled = continue_intake(
        shipped.id,
        "",
        [(b"id,status\n1,Ride\n", "Lyft_March.xlsx", "text/csv")],
        root=tmp_path,
    )
    assert "Got that" in filled.report
    assert "still need" not in filled.report


def test_build_flies_in_a_subprocess(tmp_path) -> None:
    job = open_request(
        "Build a waitlist upload page with a Submit button. go ahead",
        root=tmp_path,
        wait=False,
    )
    launched = job
    assert launched.status == "running"
    assert launched.worker_pid
    done = _wait_store(tmp_path, job.id)
    assert done.status == "report_back"
    assert done.product_relpath
    assert "available here" in done.report


def test_face_intake_then_go_ahead(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    created = client.post(
        "/api/jobs",
        data={"brief": "We need a website that takes waitlist uploads with a Submit button"},
    )
    assert created.status_code == 200, created.text
    job = created.json()
    assert job["status"] == "intake"
    assert job["bubbles"][0] == YES
    assert job["waiting"] is True
    assert not job["product_url"]
    started = client.post(f"/api/jobs/{job['id']}/continue", data={"note": "go ahead"})
    assert started.status_code == 200, started.text
    job = started.json()
    assert job["status"] in ("running", "report_back")
    assert job["building"] or job["product_url"]
    deadline = time.time() + 20
    body = job
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}").json()
        if body["status"] in ("report_back", "failed"):
            break
        time.sleep(0.1)
    assert body["status"] == "report_back"
    assert body["product_url"].endswith("/")
    assert "available here" in body["report"]


def test_shop_url_stays_intake_until_a_screenshot(tmp_path) -> None:
    job = open_request(
        "Can you optimize our shop? https://shop.soldiersangels.org/",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert job.product_relpath == ""
    assert "I've got someone working on that." in job.report
    assert "screenshot" in job.report.lower()
    assert "available here" not in job.report
    assert "finished" not in job.report.lower()


def test_any_workbook_name_satisfies_generic_need() -> None:
    need = needs_for("Reconcile Lyft to FormAssembly from an xlsx workbook")[0]
    assert need["example"] == "month.csv"
    assert have_need(need, {"workbook"}) is True


def test_named_file_still_wants_that_name(tmp_path) -> None:
    job = open_request(
        "Match lyft.csv to fa.xlsx and export the exception queue",
        root=tmp_path,
    )
    mid = continue_intake(
        job.id,
        "",
        [(b"id,status\n1,Ride\n", "rides.xlsx", "text/csv")],
        root=tmp_path,
    )
    assert mid.status == "intake"
    assert "lyft.csv" in mid.report


def test_screenshot_drop_unblocks_website(tmp_path) -> None:
    job = open_request(
        "We need a website built that does all of these things.",
        root=tmp_path,
    )
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    shipped = continue_intake(
        job.id,
        "",
        [(png, "page.png", "image/png")],
        root=tmp_path,
        sidecar=ScriptedSidecar("a waitlist page"),
    )
    assert shipped.status == "report_back"
    assert shipped.images


def test_go_dismisses_live_product_ask(tmp_path) -> None:
    job = open_request(
        "Reconcile Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert "workbook" in job.report.lower()
    done = continue_intake(job.id, "that's all", root=tmp_path)
    assert "still need" not in done.report
