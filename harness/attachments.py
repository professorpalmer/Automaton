from __future__ import annotations

"""Job files. Images, workbooks, and samples. Never drop."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from harness.paths import uploads_dir


def kind_of(filename: str, mime: str = "") -> str:
    name = (filename or "").lower()
    mime = (mime or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls", ".csv")) or "spreadsheet" in mime:
        return "workbook"
    if mime.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return "image"
    return "document"


def have_kinds(filenames: Iterable[str], mimes: Iterable[str] = ()) -> set[str]:
    kinds = set()
    mime_list = list(mimes)
    for index, name in enumerate(filenames):
        mime = mime_list[index] if index < len(mime_list) else ""
        kinds.add(kind_of(name, mime))
    return kinds


@dataclass
class FileRecord:
    id: str
    path: str
    mime: str
    bytes: int
    accepted_at: str
    name: str = ""
    kind: str = "document"
    dropped: bool = False


def accept_file(
    payload: bytes,
    *,
    filename: str,
    mime: str = "",
    job_id: str,
    root: Optional[Path] = None,
) -> FileRecord:
    if not payload:
        raise ValueError("empty file")
    dest_dir = uploads_dir(root) / job_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    suffix = Path(filename or "upload.bin").suffix or ".bin"
    dest = dest_dir / f"{file_id}{suffix}"
    dest.write_bytes(payload)
    return FileRecord(
        id=file_id,
        path=str(dest),
        mime=mime or "application/octet-stream",
        bytes=len(payload),
        accepted_at=datetime.now(timezone.utc).isoformat(),
        name=filename or dest.name,
        kind=kind_of(filename, mime),
        dropped=False,
    )
