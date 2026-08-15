from __future__ import annotations

"""Tenant secrets stay in the vault. Never the wiki. Never git. Never host keys."""

import os
from pathlib import Path
from typing import Optional

from harness.gates import (
    HOST_KEY_ENV,
    TENANT_GITHUB_ENV,
    TENANT_GITHUB_FILENAME,
    TENANT_KEY_ENV,
    TENANT_KEY_ENV_LEGACY,
    TENANT_KEY_FILENAME,
    env_get,
    may_bundle_host_keys,
)
from harness.paths import secrets_dir


class VaultError(RuntimeError):
    pass


_WIKI_PARTS = frozenset({"wiki", "raw", "conversations", "articles", "catalog"})


def path_is_wiki(path: Path) -> bool:
    parts = {part.lower() for part in Path(path).parts}
    return bool(parts & _WIKI_PARTS)


def assert_not_wiki(path: Path) -> None:
    if path_is_wiki(path):
        raise VaultError("secrets must never enter the wiki")


def redact(value: str, keep: int = 4) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if len(text) <= keep:
        return "*" * len(text)
    return text[:keep] + "…" + ("*" * min(8, len(text) - keep))


def tenant_key_path(root: Optional[Path] = None) -> Path:
    return secrets_dir(root) / TENANT_KEY_FILENAME


def load_tenant_openrouter_key(
    root: Optional[Path] = None,
    environ: Optional[dict] = None,
) -> Optional[str]:
    """Return the tenant OpenRouter key, or None.

    Host ``OPENROUTER_API_KEY`` is Cary's key. We never fall back to it.
    """
    env = environ if environ is not None else os.environ
    if not may_bundle_host_keys() and env.get(HOST_KEY_ENV) and not env_get(
        env, TENANT_KEY_ENV, TENANT_KEY_ENV_LEGACY
    ):
        # Presence of a host key must not become the tenant key.
        pass
    from_env = env_get(env, TENANT_KEY_ENV, TENANT_KEY_ENV_LEGACY)
    if from_env:
        return from_env
    path = tenant_key_path(root)
    if not path.is_file():
        return None
    assert_not_wiki(path)
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def github_token_path(root: Optional[Path] = None) -> Path:
    return secrets_dir(root) / TENANT_GITHUB_FILENAME


def load_tenant_github_token(
    root: Optional[Path] = None,
    environ: Optional[dict] = None,
) -> Optional[str]:
    env = environ if environ is not None else os.environ
    from_env = env_get(env, TENANT_GITHUB_ENV)
    if from_env:
        return from_env
    path = github_token_path(root)
    if not path.is_file():
        return None
    assert_not_wiki(path)
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def write_tenant_github_token(token: str, root: Optional[Path] = None) -> Path:
    dest = github_token_path(root)
    assert_not_wiki(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cleaned = (token or "").strip()
    if not cleaned:
        raise VaultError("refusing to write an empty GitHub token")
    dest.write_text(cleaned + "\n", encoding="utf-8")
    dest.chmod(0o600)
    return dest


def write_tenant_openrouter_key(key: str, root: Optional[Path] = None) -> Path:
    dest = tenant_key_path(root)
    assert_not_wiki(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cleaned = (key or "").strip()
    if not cleaned:
        raise VaultError("refusing to write an empty tenant key")
    dest.write_text(cleaned + "\n", encoding="utf-8")
    dest.chmod(0o600)
    return dest


def refuse_secret_payload(text: str) -> None:
    """Raise if a wiki/job note looks like it is carrying a live key."""
    blob = (text or "").lower()
    markers = (
        "sk-or-",
        "sk-or-v1-",
        "rnd_",
        "begin rsa private key",
        "aws_secret_access_key",
    )
    if any(marker in blob for marker in markers):
        raise VaultError("refusing to persist a secret-shaped payload outside the vault")
