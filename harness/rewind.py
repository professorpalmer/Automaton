from __future__ import annotations

"""Cheap no. Snapshot the product before a write. Restore is undo. No confirm."""

import json
from pathlib import Path
from typing import List, Optional

from harness.factory import product_dir, product_index
from harness.jobs import Job, JobError, JobStore
from harness.vault import refuse_secret_payload
from harness.wiki_job import write_job_page

META = "meta.json"
SNAPSHOT_NAMES = ("index.html", "spec.json", "engine.py", "app.py")


class RewindError(RuntimeError):
    pass


def checkpoint_dir(job: Job, root: Optional[Path] = None) -> Path:
    dest = product_dir(job, root) / ".checkpoints"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def _rows(job: Job, root: Optional[Path] = None) -> List[dict]:
    path = checkpoint_dir(job, root) / META
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else []


def _save_rows(job: Job, rows: List[dict], root: Optional[Path] = None) -> None:
    path = checkpoint_dir(job, root) / META
    path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def can_undo(job: Job, root: Optional[Path] = None) -> bool:
    if job.is_official():
        return False
    return bool(_rows(job, root))


def _bundle(job: Job, root: Optional[Path] = None) -> dict:
    dest_dir = product_dir(job, root)
    bundle = {}
    for name in SNAPSHOT_NAMES:
        path = dest_dir / name
        if path.is_file():
            bundle[name] = path.read_text(encoding="utf-8")
    if not bundle and product_index(job, root).is_file():
        bundle["index.html"] = product_index(job, root).read_text(encoding="utf-8")
    return bundle


def snapshot(job: Job, root: Optional[Path] = None, note: str = "") -> None:
    bundle = _bundle(job, root)
    if not bundle:
        raise JobError("no product to checkpoint")
    refuse_secret_payload(note)
    rows = _rows(job, root)
    n = len(rows) + 1
    name = f"{n:04d}.json"
    (checkpoint_dir(job, root) / name).write_text(
        json.dumps(bundle) + "\n",
        encoding="utf-8",
    )
    rows.append({"n": n, "file": name, "note": note[:80]})
    _save_rows(job, rows, root)


def restore(job: Job, root: Optional[Path] = None) -> str:
    if job.is_official():
        raise RewindError("official playbook is locked")
    rows = _rows(job, root)
    if not rows:
        raise RewindError("nothing to undo")
    last = rows.pop()
    payload = json.loads((checkpoint_dir(job, root) / last["file"]).read_text(encoding="utf-8"))
    dest_dir = product_dir(job, root)
    if isinstance(payload, dict) and any(key.endswith(".html") or key.endswith(".py") or key.endswith(".json") for key in payload):
        for name, text in payload.items():
            (dest_dir / name).write_text(text, encoding="utf-8")
    else:
        product_index(job, root).write_text(str(payload), encoding="utf-8")
    _save_rows(job, rows, root)
    return str(last.get("note") or "last change")


def run_undo(job_id: str, root: Optional[Path] = None) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    restore(job, root)
    job.report = "Put it back."
    store.save(job)
    write_job_page(job, root)
    return store.get(job.id)
