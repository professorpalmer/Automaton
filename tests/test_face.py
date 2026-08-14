from __future__ import annotations

from fastapi.testclient import TestClient

from face.app import create_app


def test_status_does_not_leak_keys(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    status = client.get("/api/status")
    assert status.status_code == 200
    body = status.json()
    assert body["screenshot_readable"] is False
    assert "sk-or" not in status.text


def test_tokens_and_reduced_motion_ship(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    tokens = client.get("/static/tokens.css")
    css = client.get("/static/app.css")
    assert tokens.status_code == 200
    assert "--space-1:" in tokens.text
    assert "--duration: 160ms" in tokens.text
    assert "prefers-reduced-motion" in css.text
    assert "13px" not in tokens.text
    assert "13px" not in css.text


def test_home_is_toyvendor(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    page = client.get("/")
    assert page.status_code == 200
    assert "ToyVendor" in page.text
    assert "Chief of staff" in page.text
    assert "CodeGraph" not in page.text
    assert "swarm" not in page.text.lower()


def test_job_and_steer_and_product(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    created = client.post(
        "/api/jobs",
        data={"brief": "Build a waitlist upload page with a Submit button"},
    )
    assert created.status_code == 200, created.text
    job = created.json()
    assert job["status"] == "report_back"
    assert job["product_url"].endswith("/")
    product = client.get(job["product_url"])
    assert product.status_code == 200
    assert "Soldiers" in product.text and "Angels" in product.text
    assert "Submit" in product.text
    steered = client.post(
        f"/api/jobs/{job['id']}/steer",
        data={"instruction": "turn that button gold"},
    )
    assert steered.status_code == 200, steered.text
    again = client.get(job["product_url"])
    assert "--accent: #c4a35a" in again.text
    ready = client.post(f"/api/jobs/{job['id']}/ready")
    assert ready.status_code == 200
    assert ready.json()["official_playbook"] is False
    checked = client.post(f"/api/jobs/{job['id']}/check")
    assert checked.status_code == 200
    assert checked.json()["official_playbook"] is True
