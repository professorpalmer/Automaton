from __future__ import annotations

"""Product gates. These are the claims we are allowed to make."""

from typing import FrozenSet, Mapping, Optional

PRODUCT_NAME = "Automaton"
TENANT_SLUG = "soldiers-angels"
TENANT_DISPLAY = "Soldiers' Angels"
TENANT_SLUG_ENV = "AUTOMATON_TENANT_SLUG"
TENANT_DISPLAY_ENV = "AUTOMATON_TENANT_DISPLAY"

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
ROOT_ENV = "AUTOMATON_ROOT"
ROOT_ENV_LEGACY = "TOYVENDOR_ROOT"
TENANT_KEY_ENV = "AUTOMATON_TENANT_OPENROUTER_API_KEY"
TENANT_KEY_ENV_LEGACY = "TOYVENDOR_TENANT_OPENROUTER_API_KEY"
TENANT_KEY_FILENAME = "openrouter.key"
TENANT_RENDER_KEY_ENV = "AUTOMATON_TENANT_RENDER_API_KEY"
TENANT_RENDER_KEY_ENV_LEGACY = "TOYVENDOR_TENANT_RENDER_API_KEY"
TENANT_RENDER_KEY_FILENAME = "render.api.key"
TENANT_GITHUB_ENV = "AUTOMATON_TENANT_GITHUB_TOKEN"
TENANT_GITHUB_FILENAME = "github.token"
BOX_ROOT_PATH = "/var/data"

PHASE_INTAKE = "intake"
PHASE_FULL_AUTO = "full_auto"
PHASE_STEER = "steer"

STATUS_PENDING = "pending"
STATUS_INTAKE = "intake"
STATUS_RUNNING = "running"
STATUS_REPORT_BACK = "report_back"
STATUS_STEERING = "steering"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


def env_get(environ: Optional[Mapping[str, str]], *names: str) -> str:
    env = environ or {}
    for name in names:
        value = (env.get(name) or "").strip()
        if value:
            return value
    return ""


def tenant_slug(environ: Optional[Mapping[str, str]] = None) -> str:
    import os

    return env_get(environ if environ is not None else os.environ, TENANT_SLUG_ENV) or TENANT_SLUG


def tenant_display(environ: Optional[Mapping[str, str]] = None) -> str:
    import os

    return env_get(environ if environ is not None else os.environ, TENANT_DISPLAY_ENV) or TENANT_DISPLAY


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
