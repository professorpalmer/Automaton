from __future__ import annotations

import json

from harness.box import ensure_box, seed_vault_from_env
from harness.gates import TENANT_KEY_ENV, TENANT_SLUG_ENV
from harness.host import load_tenant_render_key
from harness.loop import run_full_auto
from harness.paths import catalog_dir, org_root, products_dir, projects_dir, secrets_dir
from harness.vault import load_tenant_openrouter_key, path_is_wiki, write_tenant_openrouter_key


def test_box_is_self_contained(tmp_path) -> None:
    dest = ensure_box(tmp_path)
    assert dest == org_root(tmp_path)
    box = json.loads((dest / "box.json").read_text(encoding="utf-8"))
    assert box["org"] == "soldiers-angels"
    assert box["self_serve"] is True
    assert box["catalog"] == "internal"
    assert secrets_dir(tmp_path).is_dir()
    assert catalog_dir(tmp_path).is_dir()
    assert projects_dir(tmp_path).is_dir()


def test_ship_writes_box_catalog_and_named_repo(tmp_path) -> None:
    job = run_full_auto(
        "Transportation reconciliation: match Lyft to FormAssembly from an xlsx workbook",
        root=tmp_path,
    )
    product = products_dir(tmp_path) / job.id / "app.py"
    repo = projects_dir(tmp_path) / "transport-recon"
    record = catalog_dir(tmp_path) / "jobs" / f"{job.id}.json"
    graph = json.loads((catalog_dir(tmp_path) / "graph.json").read_text(encoding="utf-8"))
    env = json.loads((repo / "env.json").read_text(encoding="utf-8"))
    assert product.is_file()
    assert (repo / ".git").is_dir()
    assert (repo / "app.py").is_file()
    assert record.is_file()
    payload = json.loads(record.read_text(encoding="utf-8"))
    assert "brief" not in payload
    assert payload["slug"] == "transport-recon"
    assert any(node["id"] == "project:transport-recon" for node in graph["nodes"])
    assert env["slug"] == "transport-recon"
    assert env["product_kind"] == "service"
    assert env["connected"] == {}
    assert job.project_relpath == "tenant/soldiers-angels/projects/transport-recon"
    assert job.product_relpath.startswith("tenant/soldiers-angels/products/")


def test_box_seeds_vault_from_env_once(tmp_path) -> None:
    env = {
        TENANT_KEY_ENV: "sk-or-v1-box",
        "AUTOMATON_TENANT_RENDER_API_KEY": "rnd_box",
    }
    ensure_box(tmp_path, environ=env)
    assert load_tenant_openrouter_key(tmp_path, environ={}) == "sk-or-v1-box"
    assert load_tenant_render_key(tmp_path, environ={}) == "rnd_box"
    seed_vault_from_env(tmp_path, {TENANT_KEY_ENV: "sk-or-v1-other"})
    assert load_tenant_openrouter_key(tmp_path, environ={}) == "sk-or-v1-box"


def test_org_root_follows_tenant_slug(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv(TENANT_SLUG_ENV, "acme-relief")
    dest = ensure_box(tmp_path)
    assert dest == tmp_path / "tenant" / "acme-relief"
    assert dest == org_root(tmp_path)


def test_catalog_refuses_secrets(tmp_path) -> None:
    catalog_key = catalog_dir(tmp_path) / "openrouter.key"
    catalog_key.parent.mkdir(parents=True, exist_ok=True)
    assert path_is_wiki(catalog_key)
    write_tenant_openrouter_key("sk-or-v1-tenant", tmp_path)
    assert (secrets_dir(tmp_path) / "openrouter.key").is_file()
