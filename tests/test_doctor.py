from __future__ import annotations

from harness.doctor import doctor
from harness.gates import HOST_KEY_ENV, TENANT_KEY_ENV
from harness.vault import write_tenant_openrouter_key


def test_doctor_asks_for_tenant_key_and_ignores_host(tmp_path) -> None:
    report = doctor(
        tmp_path,
        environ={HOST_KEY_ENV: "sk-or-v1-host"},
    )
    assert report["tenant_key"] is False
    assert report["screenshot_readable"] is False
    assert report["host_key_ignored"] is True
    assert report["need_from_operator"]
    assert "sk-or-v1-host" not in str(report)


def test_doctor_clears_when_tenant_key_present(tmp_path) -> None:
    write_tenant_openrouter_key("sk-or-v1-tenant", tmp_path)
    report = doctor(tmp_path, environ={})
    assert report["tenant_key"] is True
    assert report["screenshot_readable"] is True
    assert report["need_from_operator"] == []
    assert "sk-or-v1-tenant" not in str(report)
