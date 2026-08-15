from __future__ import annotations

from harness.gates import (
    FLOOR_MODEL,
    TENANT_SLUG,
    TENANT_SLUG_ENV,
    env_grants_data_access,
    job_is_official_playbook,
    may_bundle_host_keys,
    may_sell_inference,
    tenant_slug,
    workhorse_is_text_only,
)


def test_soldiers_angels_is_the_default_tenant() -> None:
    assert TENANT_SLUG == "soldiers-angels"
    assert tenant_slug({}) == "soldiers-angels"


def test_tenant_slug_follows_env() -> None:
    assert tenant_slug({TENANT_SLUG_ENV: "acme-relief"}) == "acme-relief"


def test_flash_is_text_only_floor() -> None:
    assert FLOOR_MODEL == "deepseek/deepseek-v4-flash"
    assert workhorse_is_text_only(FLOOR_MODEL)
    assert workhorse_is_text_only("agentic/deepseek-v4-flash")
    assert not workhorse_is_text_only("qwen/qwen3-vl-30b-a3b-instruct")


def test_aligned_incentives() -> None:
    assert may_sell_inference() is False
    assert may_bundle_host_keys() is False
    assert env_grants_data_access() is False


def test_maker_checker_before_playbook() -> None:
    assert job_is_official_playbook(True, False) is False
    assert job_is_official_playbook(False, True) is False
    assert job_is_official_playbook(True, True) is True
