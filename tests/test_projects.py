from __future__ import annotations

from face.app import create_app
from fastapi.testclient import TestClient
from harness.loop import continue_intake, open_request, run_full_auto
from harness.projects import find_project, should_recall, slug_for, update_note
from harness.jobs import JobStore


def test_slug_aliases_transport() -> None:
    assert slug_for("remember that transportation project") == "transport-recon"
    assert should_recall("hey remember that transportation project? we had some ideas to update")
    assert update_note("hey remember that transportation project? we had some ideas to update") == ""
    assert update_note("remember that waitlist project? turn that button green") == "turn that button green"


def test_named_repo_and_recall(tmp_path) -> None:
    first = run_full_auto(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    from harness.paths import projects_dir

    repo = projects_dir(tmp_path) / "transport-recon"
    assert first.slug == "transport-recon"
    assert (repo / ".git").is_dir()
    assert (repo / "app.py").is_file()
    remembered = open_request(
        "hey remember that transportation project? we had some ideas to update",
        root=tmp_path,
    )
    assert remembered.id == first.id
    assert remembered.report.startswith("I have that one.")
    assert find_project(JobStore(tmp_path), "the transportation tool") is not None


def test_face_recall_does_not_start_a_new_build(tmp_path) -> None:
    first = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    client = TestClient(create_app(tmp_path))
    recalled = client.post(
        "/api/jobs",
        data={"brief": "remember that waitlist project? we had some ideas to update"},
    )
    assert recalled.status_code == 200, recalled.text
    body = recalled.json()
    assert body["id"] == first.id
    assert body["recalled"] is True
    assert body["product_url"].endswith("/")
    assert "wiki" not in body["report"].lower()


def test_remember_miss_stays_intake(tmp_path) -> None:
    job = open_request(
        "remember that transportation project?",
        root=tmp_path,
    )
    assert job.status == "intake"
    assert "do not have a project" in job.report
    shipped = continue_intake(job.id, "go ahead", root=tmp_path)
    assert shipped.status == "report_back"
