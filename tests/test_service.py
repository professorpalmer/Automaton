from __future__ import annotations

import io

from fastapi.testclient import TestClient
from openpyxl import Workbook

from face.app import create_app
from harness.factory import parse_spec, wants_service
from harness.loop import run_full_auto


def test_waitlist_stays_a_poster() -> None:
    assert wants_service("Build a waitlist upload page with a Submit button") is False
    assert parse_spec("Build a waitlist upload page with a Submit button").kind == "poster"
    assert wants_service("update the sa-hotb render app FormAssembly links") is False


def test_transport_brief_ships_a_render_service(tmp_path) -> None:
    assert wants_service(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook and export exceptions"
    )
    job = run_full_auto(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook and export exceptions",
        root=tmp_path,
    )
    from harness.paths import products_dir

    dest = products_dir(tmp_path) / job.id
    assert (dest / "app.py").is_file()
    assert (dest / "engine.py").is_file()
    assert (dest / "render.yaml").is_file()
    assert "FormAssembly" in job.report
    assert "SharePoint" in job.report
    client = TestClient(create_app(tmp_path))
    page = client.get(f"/product/{job.id}/")
    assert page.status_code == 200
    assert "Soldiers" in page.text and "Angels" in page.text
    assert "not connected" in page.text.lower()
    book = Workbook()
    fa = book.active
    fa.title = "FA"
    fa.append(["id", "name"])
    fa.append(["1", "Ann"])
    lyft = book.create_sheet("Lyft")
    lyft.append(["id", "status"])
    lyft.append(["1", "Ride"])
    buf = io.BytesIO()
    book.save(buf)
    ran = client.post(
        f"/product/{job.id}/run",
        files={"upload": ("month.xlsx", buf.getvalue(), "application/vnd.ms-excel")},
    )
    assert ran.status_code == 200, ran.text
    assert "Matched 1" in ran.text
    assert "Ledger" in ran.text
    ledger = client.get(f"/product/{job.id}/export/ledger.csv")
    assert ledger.status_code == 200
    assert "matched_status" in ledger.text
    assert client.get(f"/product/{job.id}/login").status_code == 404


def test_two_csv_upload_matches(tmp_path) -> None:
    job = run_full_auto(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook and export exceptions",
        root=tmp_path,
    )
    client = TestClient(create_app(tmp_path))
    home = client.get(f"/product/{job.id}/")
    assert "second CSV" in home.text
    ran = client.post(
        f"/product/{job.id}/run",
        files={
            "upload": ("fa.csv", b"id,name\n1,Ann\n2,Ben\n", "text/csv"),
            "other": ("lyft.csv", b"id,status\n1,Ride\n2,Cancel\n", "text/csv"),
        },
    )
    assert ran.status_code == 200, ran.text
    assert "Matched 1" in ran.text
    assert "Exceptions" in ran.text
