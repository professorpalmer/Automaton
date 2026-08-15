from __future__ import annotations

from fastapi.testclient import TestClient

from harness.gates import HOST_KEY_ENV, ROOT_ENV, TENANT_KEY_ENV, TENANT_SLUG_ENV
from provision.app import create_app
from provision.render_api import ScriptedRender
from provision.seed import seed_env
from provision.spec import BoxSpec, StampError, spec_from_payload
from provision.stamp import stamp_box, update_box
from provision.store import BoxStore
import pytest


def _spec(**overrides) -> BoxSpec:
    payload = {
        "slug": "soldiers-angels",
        "display": "Soldiers' Angels",
        "render_api_key": "rnd_client",
        "openrouter_api_key": "sk-or-v1-client",
        "github_token": "ghp_client",
    }
    payload.update(overrides)
    return spec_from_payload(payload)


def test_seed_env_is_their_keys_only() -> None:
    rows = {row["key"]: row["value"] for row in seed_env(_spec())}
    assert rows[TENANT_SLUG_ENV] == "soldiers-angels"
    assert rows[ROOT_ENV] == "/var/data"
    assert rows[TENANT_KEY_ENV] == "sk-or-v1-client"
    assert HOST_KEY_ENV not in rows
    with pytest.raises(StampError):
        seed_env(_spec(extras={HOST_KEY_ENV: "sk-or-v1-cary"}))


def test_stamp_puts_the_box_on_their_render(tmp_path) -> None:
    host = ScriptedRender()
    record = stamp_box(_spec(), root=tmp_path, client=host)
    assert record.status == "live"
    assert record.url == "https://soldiers-angels-automaton.onrender.com"
    assert record.service_id == "srv_soldiers-angels"
    assert host.created == ["soldiers-angels-automaton"]
    stored = BoxStore(tmp_path).get("soldiers-angels")
    assert stored is not None
    assert stored.url == record.url
    text = (tmp_path / "boxes" / "soldiers-angels.json").read_text(encoding="utf-8")
    assert "rnd_client" not in text
    assert "sk-or-v1-client" not in text
    assert BoxStore(tmp_path).load_render_key("soldiers-angels") == "rnd_client"


def test_second_stamp_updates_the_same_service(tmp_path) -> None:
    host = ScriptedRender()
    first = stamp_box(_spec(), root=tmp_path, client=host)
    second = stamp_box(_spec(branch="main"), root=tmp_path, client=host)
    assert first.service_id == second.service_id
    assert host.created == ["soldiers-angels-automaton"]
    assert host.updated == [first.service_id]


def test_update_without_stored_key_stays_honest(tmp_path) -> None:
    host = ScriptedRender()
    stamp_box(_spec(), root=tmp_path, client=host)
    (tmp_path / "secrets" / "soldiers-angels" / "render.api.key").unlink()
    record = update_box("soldiers-angels", root=tmp_path, client=host)
    assert record.need == "render_key"
    assert record.url == "https://soldiers-angels-automaton.onrender.com"


def test_host_face_returns_their_url(tmp_path) -> None:
    client = TestClient(create_app(tmp_path, client=ScriptedRender()))
    page = client.get("/")
    assert page.status_code == 200
    assert "Host" in page.text
    assert "Automaton" in page.text
    created = client.post(
        "/api/boxes",
        json={
            "slug": "soldiers-angels",
            "display": "Soldiers' Angels",
            "render_api_key": "rnd_client",
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["url"] == "https://soldiers-angels-automaton.onrender.com"
    assert "rnd_client" not in created.text
    listed = client.get("/api/boxes")
    assert listed.json()["boxes"][0]["url"] == body["url"]


def test_host_token_is_required_when_set(tmp_path) -> None:
    client = TestClient(create_app(tmp_path, client=ScriptedRender(), token="host-secret"))
    assert client.get("/api/boxes").status_code == 401
    ok = client.get("/api/boxes", headers={"Authorization": "Bearer host-secret"})
    assert ok.status_code == 200


def test_missing_render_key_is_refused() -> None:
    with pytest.raises(StampError):
        spec_from_payload({"slug": "soldiers-angels", "display": "Soldiers' Angels"})
