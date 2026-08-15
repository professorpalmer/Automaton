from __future__ import annotations

import pytest

from harness.gates import HOST_KEY_ENV, TENANT_KEY_ENV, TENANT_KEY_ENV_LEGACY
from harness.vault import (
    VaultError,
    load_tenant_openrouter_key,
    path_is_wiki,
    redact,
    refuse_secret_payload,
    write_tenant_openrouter_key,
)


def test_host_key_is_never_the_tenant_key(tmp_path) -> None:
    env = {HOST_KEY_ENV: "sk-or-v1-host-key-must-not-leak"}
    assert load_tenant_openrouter_key(tmp_path, environ=env) is None


def test_tenant_env_and_file(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv(TENANT_KEY_ENV, raising=False)
    assert load_tenant_openrouter_key(tmp_path) is None
    write_tenant_openrouter_key("sk-or-v1-tenant", tmp_path)
    assert load_tenant_openrouter_key(tmp_path) == "sk-or-v1-tenant"
    monkeypatch.setenv(TENANT_KEY_ENV, "sk-or-v1-from-env")
    assert load_tenant_openrouter_key(tmp_path) == "sk-or-v1-from-env"
    monkeypatch.delenv(TENANT_KEY_ENV, raising=False)
    monkeypatch.setenv(TENANT_KEY_ENV_LEGACY, "sk-or-v1-legacy")
    assert load_tenant_openrouter_key(tmp_path) == "sk-or-v1-legacy"


def test_refuse_wiki_write(tmp_path) -> None:
    wiki = tmp_path / "wiki" / "secrets" / "openrouter.key"
    wiki.parent.mkdir(parents=True)
    assert path_is_wiki(wiki)
    with pytest.raises(VaultError, match="wiki"):
        write_tenant_openrouter_key("sk-or-v1-nope", tmp_path / "wiki")


def test_refuse_secret_shaped_wiki_note() -> None:
    with pytest.raises(VaultError):
        refuse_secret_payload("here is the key sk-or-v1-abc")


def test_redact_does_not_echo_the_key() -> None:
    assert "secret-value" not in redact("sk-or-v1-secret-value")
    assert redact("sk-or-v1-secret-value").startswith("sk-o")
