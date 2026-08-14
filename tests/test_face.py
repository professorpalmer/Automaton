from __future__ import annotations

from fastapi.testclient import TestClient

from face.app import create_app


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
