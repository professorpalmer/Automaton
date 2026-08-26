from __future__ import annotations

"""Durable worker handoff. JSON on disk. The operator never sees this folder."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from harness.intake import have_need, still_ask, still_needed
from harness.jobs import Job
from harness.paths import jobs_dir
from harness.vault import refuse_secret_payload


def artifact_dir(job_id: str, root: Optional[Path] = None) -> Path:
    dest = jobs_dir(root) / f"{job_id}.artifacts"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def write_handoff(job: Job, root: Optional[Path] = None, reason: str = "") -> Path:
    dest = artifact_dir(job.id, root) / "handoff.json"
    payload = {
        "job": job.id,
        "slug": job.slug,
        "reason": reason,
        "brief": job.brief,
        "files": [record.name for record in job.files],
        "images": len(job.images),
        "needed": [item.get("id") for item in (job.needed or [])],
        "product": job.product_relpath,
        "project": job.project_relpath,
        "live_url": job.live_url,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    refuse_secret_payload(json.dumps(payload))
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return dest


def write_result(job: Job, root: Optional[Path] = None, extra: Optional[dict] = None) -> Path:
    dest = artifact_dir(job.id, root) / "result.json"
    payload = {
        "job": job.id,
        "slug": job.slug,
        "product": job.product_relpath,
        "project": job.project_relpath,
        "live_url": job.live_url,
        "sealed": job.sealed,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        payload.update(extra)
    refuse_secret_payload(json.dumps(payload))
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return dest


def record_worker(job: Job, role: str, status: str, root: Optional[Path] = None) -> None:
    row = {
        "at": datetime.now(timezone.utc).isoformat(),
        "role": role,
        "status": status,
    }
    refuse_secret_payload(json.dumps(row))
    job.crew.append(row)
    log = artifact_dir(job.id, root) / "crew.jsonl"
    with log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")


def sync_asks(job: Job) -> List[dict]:
    leftover = still_needed(job.needed or [], job)
    leftover_ids = {item.get("id") for item in leftover}
    by_need = {ask.get("need_id"): ask for ask in job.asks if ask.get("need_id")}
    for need in leftover:
        nid = need.get("id") or ""
        text = still_ask(need)
        if nid in by_need:
            by_need[nid]["status"] = "open"
            by_need[nid]["text"] = text
            continue
        ask = {
            "id": nid or f"ask-{len(job.asks) + 1}",
            "need_id": nid,
            "kind": "file",
            "text": text,
            "status": "open",
        }
        job.asks.append(ask)
        by_need[nid] = ask
    for ask in job.asks:
        nid = ask.get("need_id")
        if not nid:
            continue
        if nid not in leftover_ids:
            ask["status"] = "answered"
    return open_asks(job)


def open_asks(job: Job) -> List[dict]:
    return [ask for ask in (job.asks or []) if ask.get("status") == "open"]


def post_ask(job: Job, text: str, *, kind: str = "question", need_id: str = "") -> dict:
    refuse_secret_payload(text)
    ask = {
        "id": need_id or f"ask-{len(job.asks) + 1}",
        "need_id": need_id,
        "kind": kind,
        "text": text,
        "status": "open",
    }
    job.asks.append(ask)
    return ask
