from __future__ import annotations

import time

from fastapi.testclient import TestClient

from face.app import create_app


def _wait_job(client: TestClient, job_id: str, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if last.get("status") in ("report_back", "steering", "done", "failed"):
            return last
        time.sleep(0.1)
    raise AssertionError("build did not finish: " + str(last.get("status")))


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
    assert "color-mix(in oklab" in tokens.text
    assert "light-dark(" in tokens.text
    assert "overflow-anchor: auto" in css.text
    assert "scroll-padding-bottom" in css.text
    assert "overscroll-behavior: contain" in css.text
    assert "scrollbar-gutter: stable" in css.text
    assert "content-visibility: auto" in css.text
    assert "field-sizing: content" in css.text
    js = client.get("/static/app.js").text
    assert "visualViewport" in js
    assert "confirm(" not in js
    assert "/continue" in js
    assert "not that file type" in js
    assert "Change the tool to match this screenshot." in js
    assert "I've got someone working on that." in js
    assert "Let me pull that up." in js
    assert "I've got a team working on your request." in js
    assert "add to wiki" not in js.lower()
    assert "13px" not in tokens.text
    assert "13px" not in css.text
    assert "repeating-linear-gradient" not in css.text
    assert "--accent:" in tokens.text
    assert "--kicker:" in tokens.text
    assert "Space Grotesk" in tokens.text


def test_home_is_automaton(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    page = client.get("/")
    assert page.status_code == 200
    assert "Automaton" in page.text
    assert "ToyVendor" not in page.text
    assert "Chief of staff" in page.text
    assert "CodeGraph" not in page.text
    assert "swarm" not in page.text.lower()
    assert "talk-anchor" in page.text
    assert 'id="undo"' in page.text
    assert "Add files" in page.text
    assert ".xlsx" in page.text
    assert "required></textarea>" not in page.text
    assert "are you sure" not in page.text.lower()


def test_job_and_steer_and_product(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    created = client.post(
        "/api/jobs",
        data={"brief": "Build a waitlist upload page with a Submit button. go ahead"},
    )
    assert created.status_code == 200, created.text
    opened = created.json()
    assert opened["status"] in ("running", "report_back")
    assert opened["bubbles"][0] == "I've got someone working on that."
    job = _wait_job(client, opened["id"])
    assert job["status"] == "report_back"
    assert job["product_url"].endswith("/")
    assert "available here" in job["bubbles"][0]
    assert job["waiting"] is True
    assert job["can_undo"] is False
    assert "waves" not in job
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
    assert steered.json()["can_undo"] is True
    undone = client.post(f"/api/jobs/{job['id']}/undo")
    assert undone.status_code == 200, undone.text
    assert undone.json()["report"] == "Put it back."
    assert undone.json()["can_undo"] is False
    restored = client.get(job["product_url"])
    assert "--accent: #c4a35a" not in restored.text
    ready = client.post(f"/api/jobs/{job['id']}/ready")
    assert ready.status_code == 200
    assert ready.json()["official_playbook"] is False
    checked = client.post(f"/api/jobs/{job['id']}/check")
    assert checked.status_code == 200
    assert checked.json()["official_playbook"] is True
