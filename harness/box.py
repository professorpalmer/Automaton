from __future__ import annotations

"""One self-serve org box. Their env, catalog, and project repos."""

import json
import os
from pathlib import Path
from typing import Mapping, Optional

from harness.gates import (
    ROOT_ENV,
    ROOT_ENV_LEGACY,
    TENANT_GITHUB_ENV,
    TENANT_KEY_ENV,
    TENANT_KEY_ENV_LEGACY,
    TENANT_RENDER_KEY_ENV,
    TENANT_RENDER_KEY_ENV_LEGACY,
    env_get,
    tenant_display,
    tenant_slug,
)
from harness.paths import catalog_dir, jobs_dir, org_root, products_dir, projects_dir, secrets_dir, uploads_dir
from harness.vault import refuse_secret_payload


def ensure_box(root: Optional[Path] = None, environ: Optional[Mapping[str, str]] = None) -> Path:
    dest = org_root(root)
    dest.mkdir(parents=True, exist_ok=True)
    for folder in (
        secrets_dir(root),
        jobs_dir(root),
        products_dir(root),
        uploads_dir(root),
        catalog_dir(root),
        catalog_dir(root) / "jobs",
        projects_dir(root),
    ):
        folder.mkdir(parents=True, exist_ok=True)
    box = dest / "box.json"
    payload = {
        "org": tenant_slug(environ),
        "display": tenant_display(environ),
        "self_serve": True,
        "catalog": "internal",
        "projects": "projects",
        "secrets": "secrets",
    }
    refuse_secret_payload(json.dumps(payload))
    if not box.is_file():
        box.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if _should_seed_from_env(root, environ):
        seed_vault_from_env(root, environ)
    return dest


def _should_seed_from_env(root: Optional[Path], environ: Optional[Mapping[str, str]]) -> bool:
    if environ is not None:
        return True
    box_root = env_get(os.environ, ROOT_ENV, ROOT_ENV_LEGACY)
    if not box_root:
        return False
    if root is None:
        return True
    return Path(box_root).resolve() == Path(root).resolve()


def seed_vault_from_env(root: Optional[Path] = None, environ: Optional[Mapping[str, str]] = None) -> None:
    """Copy tenant env into the box vault once. Do not overwrite a file the operator dropped."""
    env = dict(environ) if environ is not None else dict(os.environ)
    from harness.host import load_tenant_render_key, write_tenant_render_key
    from harness.vault import (
        load_tenant_github_token,
        load_tenant_openrouter_key,
        write_tenant_github_token,
        write_tenant_openrouter_key,
    )

    openrouter = env_get(env, TENANT_KEY_ENV, TENANT_KEY_ENV_LEGACY)
    if openrouter and not load_tenant_openrouter_key(root, environ={}):
        write_tenant_openrouter_key(openrouter, root)
    render = env_get(env, TENANT_RENDER_KEY_ENV, TENANT_RENDER_KEY_ENV_LEGACY)
    if render and not load_tenant_render_key(root, environ={}):
        write_tenant_render_key(render, root)
    github = env_get(env, TENANT_GITHUB_ENV)
    if github and not load_tenant_github_token(root, environ={}):
        write_tenant_github_token(github, root)
