from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from harness.vault import assert_not_wiki, refuse_secret_payload
from provision.store import host_root

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InquiryError(ValueError):
    pass


@dataclass
class Inquiry:
    id: str
    org: str
    name: str
    email: str
    note: str
    created_at: str

    def public(self) -> dict:
        return asdict(self)


def inquiries_dir(root: Optional[Path] = None) -> Path:
    return host_root(root) / "inquiries"


class InquiryStore:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = host_root(root)
        inquiries_dir(self.root).mkdir(parents=True, exist_ok=True)

    def add(self, org: str, name: str, email: str, note: str = "") -> Inquiry:
        cleaned = Inquiry(
            id=str(uuid.uuid4()),
            org=_require(org, "org name"),
            name=_require(name, "your name"),
            email=_email(email),
            note=(note or "").strip(),
            created_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        )
        refuse_secret_payload(json.dumps(cleaned.public()))
        dest = inquiries_dir(self.root) / f"{cleaned.id}.json"
        assert_not_wiki(dest)
        dest.write_text(json.dumps(cleaned.public(), indent=2) + "\n", encoding="utf-8")
        return cleaned

    def list_inquiries(self) -> list[Inquiry]:
        rows = []
        for path in sorted(inquiries_dir(self.root).glob("*.json"), reverse=True):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                rows.append(
                    Inquiry(
                        id=str(payload.get("id") or ""),
                        org=str(payload.get("org") or ""),
                        name=str(payload.get("name") or ""),
                        email=str(payload.get("email") or ""),
                        note=str(payload.get("note") or ""),
                        created_at=str(payload.get("created_at") or ""),
                    )
                )
        return rows


def _require(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise InquiryError(f"{label} is required")
    return cleaned


def _email(value: str) -> str:
    cleaned = (value or "").strip()
    if not _EMAIL.match(cleaned):
        raise InquiryError("a real email is required")
    return cleaned
