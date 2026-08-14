from __future__ import annotations

"""Data-access-first: keys in env are not FormAssembly / SharePoint / Salesforce."""

from typing import Mapping

SYSTEMS = ("formassembly", "sharepoint", "salesforce")


def systems_granted_by_env(environ: Mapping[str, str] | None = None) -> tuple[str, ...]:
    del environ
    return ()


def claims_live_system_access(text: str) -> bool:
    blob = (text or "").lower()
    needles = (
        "connected to salesforce",
        "connected to sharepoint",
        "connected to formassembly",
        "logged into salesforce",
    )
    return any(needle in blob for needle in needles)
