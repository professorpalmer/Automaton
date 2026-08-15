from __future__ import annotations

from harness.host import ScriptedHost, load_tenant_render_key
from harness.loop import continue_intake, open_request, run_full_auto, run_steer
from harness.paths import projects_dir


def test_scripted_host_puts_a_render_url_on_the_job(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
        host=ScriptedHost("https://sa-waitlist.onrender.com"),
    )
    assert job.live_url == "https://sa-waitlist.onrender.com"
    assert "https://sa-waitlist.onrender.com" in job.report
    assert "polish it exactly how you like" in job.report
    assert "Render API key" not in job.report


def test_missing_render_key_stays_honest(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
    )
    assert job.live_url == ""
    assert "available here at /product/" in job.report
    assert "Render API key" in job.report


def test_render_key_file_goes_to_the_vault(tmp_path) -> None:
    job = open_request(
        "Build a waitlist upload page with a Submit button",
        [(b"rnd_test-key\n", "render.api.key", "text/plain")],
        root=tmp_path,
        host=ScriptedHost("https://sa-waitlist.onrender.com"),
    )
    assert load_tenant_render_key(tmp_path) == "rnd_test-key"
    assert not any(record.name == "render.api.key" for record in job.files)
    assert job.live_url == "https://sa-waitlist.onrender.com"


def test_operator_can_seal_the_project(tmp_path) -> None:
    job = run_full_auto(
        "Build a waitlist upload page with a Submit button",
        root=tmp_path,
        host=ScriptedHost(),
    )
    done = run_steer(job.id, "this is it, perfect, it's done", root=tmp_path)
    assert done.sealed is True
    assert done.status == "done"
    assert "keep the project" in done.report


def test_file_drop_writes_a_followup_artifact(tmp_path) -> None:
    job = open_request(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
        host=ScriptedHost(),
    )
    filled = continue_intake(
        job.id,
        "",
        [(b"id,status\n1,Ride\n", "month.csv", "text/csv")],
        root=tmp_path,
        host=ScriptedHost(),
    )
    artifact = tmp_path / "tenant" / "soldiers-angels" / "jobs" / f"{job.id}.artifacts" / "handoff.json"
    assert artifact.is_file()
    assert "month.csv" in artifact.read_text(encoding="utf-8")
    assert (projects_dir(tmp_path) / "transport-recon" / "app.py").is_file()
    assert filled.crew
