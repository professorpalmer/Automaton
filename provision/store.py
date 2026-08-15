from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from harness.vault import VaultError, assert_not_wiki, refuse_secret_payload
from provision.spec import BoxRecord


def host_root(root: Optional[Path] = None) -> Path:
    return Path(root) if root is not None else Path.cwd() / "var" / "host"


def boxes_dir(root: Optional[Path] = None) -> Path:
    return host_root(root) / "boxes"


def host_secrets_dir(root: Optional[Path] = None) -> Path:
    return host_root(root) / "secrets"


class BoxStore:
    """Our records of stamped boxes. Public JSON never holds keys."""

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = host_root(root)
        boxes_dir(self.root).mkdir(parents=True, exist_ok=True)
        host_secrets_dir(self.root).mkdir(parents=True, exist_ok=True)

    def list_boxes(self) -> list[BoxRecord]:
        rows = []
        for path in sorted(boxes_dir(self.root).glob("*.json")):
            record = self._read(path)
            if record is not None:
                rows.append(record)
        return rows

    def get(self, slug: str) -> Optional[BoxRecord]:
        path = boxes_dir(self.root) / f"{slug}.json"
        if not path.is_file():
            return None
        return self._read(path)

    def save(self, record: BoxRecord) -> Path:
        dest = boxes_dir(self.root) / f"{record.slug}.json"
        assert_not_wiki(dest)
        payload = record.public()
        refuse_secret_payload(json.dumps(payload))
        dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return dest

    def save_render_key(self, slug: str, key: str) -> Path:
        dest = host_secrets_dir(self.root) / slug / "render.api.key"
        assert_not_wiki(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        cleaned = (key or "").strip()
        if not cleaned:
            raise VaultError("refusing to write an empty Render key")
        dest.write_text(cleaned + "\n", encoding="utf-8")
        dest.chmod(0o600)
        return dest

    def load_render_key(self, slug: str) -> str:
        path = host_secrets_dir(self.root) / slug / "render.api.key"
        if not path.is_file():
            return ""
        assert_not_wiki(path)
        return path.read_text(encoding="utf-8").strip()

    def _read(self, path: Path) -> Optional[BoxRecord]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        refuse_secret_payload(json.dumps(payload))
        return BoxRecord(
            slug=str(payload.get("slug") or ""),
            display=str(payload.get("display") or ""),
            service_id=str(payload.get("service_id") or ""),
            url=str(payload.get("url") or ""),
            repo=str(payload.get("repo") or ""),
            branch=str(payload.get("branch") or ""),
            image=str(payload.get("image") or ""),
            status=str(payload.get("status") or ""),
            need=str(payload.get("need") or ""),
            ask=str(payload.get("ask") or ""),
            updated_at=str(payload.get("updated_at") or ""),
        )
