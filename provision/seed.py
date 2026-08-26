from __future__ import annotations

from harness.gates import (
    BOX_ROOT_PATH,
    HOST_KEY_ENV,
    ROOT_ENV,
    TENANT_DISPLAY_ENV,
    TENANT_GITHUB_ENV,
    TENANT_KEY_ENV,
    TENANT_RENDER_KEY_ENV,
    TENANT_SLUG_ENV,
    may_bundle_host_keys,
    may_sell_inference,
)
from provision.spec import BoxSpec, StampError

BUILD_COMMAND = "pip install -e ."
START_COMMAND = "automaton --host 0.0.0.0 --port $PORT"
DISK_MOUNT = BOX_ROOT_PATH
DISK_SIZE_GB = 10


def seed_env(spec: BoxSpec) -> list[dict[str, str]]:
    """Env the Automaton box receives. Client keys only. Never the host operator key."""
    if may_sell_inference() or may_bundle_host_keys():
        raise StampError("host gates forbid selling inference or bundling our keys")
    rows: list[dict[str, str]] = [
        {"key": TENANT_SLUG_ENV, "value": spec.slug},
        {"key": TENANT_DISPLAY_ENV, "value": spec.display},
        {"key": ROOT_ENV, "value": BOX_ROOT_PATH},
    ]
    if spec.openrouter_api_key:
        rows.append({"key": TENANT_KEY_ENV, "value": spec.openrouter_api_key})
    if spec.render_api_key:
        rows.append({"key": TENANT_RENDER_KEY_ENV, "value": spec.render_api_key})
    if spec.github_token:
        rows.append({"key": TENANT_GITHUB_ENV, "value": spec.github_token})
    for name, value in spec.extras.items():
        key = (name or "").strip()
        if not key or key.upper() == HOST_KEY_ENV:
            raise StampError("refusing to put a host key on a client box")
        rows.append({"key": key, "value": str(value)})
    names = [row["key"] for row in rows]
    if HOST_KEY_ENV in names:
        raise StampError("refusing to put a host key on a client box")
    return rows


def disk_for(spec: BoxSpec) -> dict:
    return {
        "name": spec.slug + "-box",
        "sizeGB": DISK_SIZE_GB,
        "mountPath": DISK_MOUNT,
    }
