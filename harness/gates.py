from __future__ import annotations

"""Product gates. These are the claims we are allowed to make."""

from typing import FrozenSet

TENANT_SLUG = "soldiers-angels"
TENANT_DISPLAY = "Soldiers' Angels"

# OpenRouter slugs. Flash is the cheap floor and is text-only.
FLOOR_MODEL = "deepseek/deepseek-v4-flash"
ESCALATE_ONCE_MODEL = "deepseek/deepseek-v4-pro"
VISION_SIDECAR_MODEL = "qwen/qwen3-vl-30b-a3b-instruct"

TEXT_ONLY_MODELS: FrozenSet[str] = frozenset(
    {
        FLOOR_MODEL,
        ESCALATE_ONCE_MODEL,
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "agentic/deepseek-v4-flash",
        "agentic/deepseek/deepseek-v4-flash",
        "agentic/deepseek/deepseek-v4-pro",
    }
)

HOST_KEY_ENV = "OPENROUTER_API_KEY"
TENANT_KEY_ENV = "TOYVENDOR_TENANT_OPENROUTER_API_KEY"
TENANT_KEY_FILENAME = "openrouter.key"

PHASE_FULL_AUTO = "full_auto"
PHASE_STEER = "steer"

STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_REPORT_BACK = "report_back"
STATUS_STEERING = "steering"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


def workhorse_is_text_only(model_id: str) -> bool:
    slug = (model_id or "").strip().lower()
    if slug in TEXT_ONLY_MODELS:
        return True
    return slug.endswith("deepseek-v4-flash") or slug.endswith("deepseek-v4-pro")


def may_sell_inference() -> bool:
    return False


def may_bundle_host_keys() -> bool:
    return False


def env_grants_data_access() -> bool:
    """Env vars hold keys. They do not grant FormAssembly / SharePoint / Salesforce."""
    return False


def job_is_official_playbook(official: bool, maker_checked: bool) -> bool:
    return bool(official) and bool(maker_checked)
