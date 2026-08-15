from __future__ import annotations

"""Honest runtime status. Never print secrets."""

import os
from pathlib import Path
from typing import Dict, Optional

from harness.budget import load_cap_usd
from harness.gates import (
    HOST_KEY_ENV,
    TENANT_KEY_ENV,
    TENANT_KEY_ENV_LEGACY,
    env_get,
    tenant_display,
    tenant_slug,
)
from harness.host import load_tenant_render_key
from harness.vault import load_tenant_openrouter_key


def doctor(root: Optional[Path] = None, environ: Optional[dict] = None) -> Dict[str, object]:
    env = environ if environ is not None else os.environ
    tenant_key = bool(load_tenant_openrouter_key(root, environ=env))
    render_key = bool(load_tenant_render_key(root, environ=env))
    host_key_present = bool((env.get(HOST_KEY_ENV) or "").strip())
    return {
        "tenant": tenant_display(env),
        "tenant_key": tenant_key,
        "render_key": render_key,
        "host_key_ignored": host_key_present
        and not bool(env_get(env, TENANT_KEY_ENV, TENANT_KEY_ENV_LEGACY)),
        "screenshot_readable": tenant_key,
        "budget_cap_usd": load_cap_usd(root),
        "need_from_operator": []
        if tenant_key
        else [
            f"Put the {tenant_display(env)} OpenRouter key in tenant/{tenant_slug(env)}/secrets/openrouter.key "
            f"or export {TENANT_KEY_ENV}. Host keys are ignored."
        ],
    }
