from __future__ import annotations

"""Honest runtime status. Never print secrets."""

import os
from pathlib import Path
from typing import Dict, Optional

from harness.budget import load_cap_usd
from harness.gates import HOST_KEY_ENV, TENANT_DISPLAY, TENANT_KEY_ENV
from harness.vault import load_tenant_openrouter_key


def doctor(root: Optional[Path] = None, environ: Optional[dict] = None) -> Dict[str, object]:
    env = environ if environ is not None else os.environ
    tenant_key = bool(load_tenant_openrouter_key(root, environ=env))
    host_key_present = bool((env.get(HOST_KEY_ENV) or "").strip())
    return {
        "tenant": TENANT_DISPLAY,
        "tenant_key": tenant_key,
        "host_key_ignored": host_key_present and not bool((env.get(TENANT_KEY_ENV) or "").strip()),
        "screenshot_readable": tenant_key,
        "budget_cap_usd": load_cap_usd(root),
        "need_from_operator": []
        if tenant_key
        else [
            "Put the Soldiers' Angels OpenRouter key in tenant/secrets/openrouter.key "
            f"or export {TENANT_KEY_ENV}. Host keys are ignored."
        ],
    }
