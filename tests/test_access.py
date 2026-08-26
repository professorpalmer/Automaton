from __future__ import annotations

from harness.access import claims_live_system_access, systems_granted_by_env
from harness.gates import env_grants_data_access


def test_env_never_grants_sa_systems() -> None:
    assert env_grants_data_access() is False
    assert systems_granted_by_env({"SALESFORCE_TOKEN": "x", "SHAREPOINT_TOKEN": "y"}) == ()


def test_detects_false_connection_claims() -> None:
    assert claims_live_system_access("Connected to Salesforce and pulled the report")
    assert not claims_live_system_access("Build a waitlist upload page")
