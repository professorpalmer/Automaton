from __future__ import annotations

"""Internal per-org catalog. Not Portable LLM Wiki. The operator never sees it."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from harness.box import ensure_box
from harness.jobs import Job
from harness.paths import catalog_dir
from harness.receipts import job_spend_usd
from harness.vault import refuse_secret_payload

_ENTITIES: Dict[str, List[Tuple[str, str]]] = {
    "transport-recon": [
        ("soldiers-angels", "Soldiers' Angels"),
        ("lyft", "Lyft"),
        ("formassembly", "FormAssembly"),
    ],
    "waitlist": [("soldiers-angels", "Soldiers' Angels")],
    "letter-pack": [("soldiers-angels", "Soldiers' Angels")],
}


def write_job_page(
    job: Job,
    root: Optional[Path] = None,
    *,
    reused_from: str = "",
    event: str = "ship",
) -> Path:
    refuse_secret_payload(job.brief)
    refuse_secret_payload(job.report)
    ensure_box(root)
    dest_dir = catalog_dir(root)
    record = {
        "id": job.id,
        "slug": getattr(job, "slug", "") or "",
        "project": getattr(job, "project_relpath", "") or "",
        "product": job.product_relpath,
        "replay_key": getattr(job, "replay_key", "") or "",
        "spend_usd": job_spend_usd(job.receipts),
        "reused_from": reused_from,
        "event": event,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    refuse_secret_payload(json.dumps(record))
    dest = dest_dir / "jobs" / f"{job.id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    maintain_graph(dest_dir, job=job, event=event, reused_from=reused_from)
    return dest


def entities_for(slug: str) -> List[Tuple[str, str]]:
    return list(_ENTITIES.get(slug) or [("soldiers-angels", "Soldiers' Angels")])


def maintain_graph(
    dest_dir: Path,
    *,
    job: Optional[Job] = None,
    event: str = "ship",
    reused_from: str = "",
) -> None:
    jobs = _scan_jobs(dest_dir)
    slugs = sorted({row["slug"] for row in jobs if row.get("slug")})
    entities: Dict[str, dict] = {}
    for slug in slugs:
        for eid, title in entities_for(slug):
            entities.setdefault(eid, {"title": title, "projects": []})
            if slug not in entities[eid]["projects"]:
                entities[eid]["projects"].append(slug)
    graph = {
        "kind": "tenant-catalog",
        "nodes": [{"id": "org", "type": "org", "title": "Soldiers' Angels"}],
        "edges": [],
    }
    for slug in slugs:
        graph["nodes"].append({"id": f"project:{slug}", "type": "project", "title": slug})
        graph["edges"].append({"from": "org", "to": f"project:{slug}", "rel": "owns"})
    for eid, meta in entities.items():
        graph["nodes"].append({"id": f"entity:{eid}", "type": "entity", "title": meta["title"]})
        for slug in meta["projects"]:
            graph["edges"].append(
                {"from": f"project:{slug}", "to": f"entity:{eid}", "rel": "related"}
            )
    for row in jobs:
        graph["nodes"].append({"id": f"job:{row['id']}", "type": "job", "title": row["id"]})
        if row.get("slug"):
            graph["edges"].append(
                {"from": f"job:{row['id']}", "to": f"project:{row['slug']}", "rel": "job_of"}
            )
    refuse_secret_payload(json.dumps(graph))
    dest_dir.joinpath("graph.json").write_text(
        json.dumps(graph, indent=2) + "\n",
        encoding="utf-8",
    )
    if job is not None:
        _append_log(dest_dir, job, event, reused_from)


def _scan_jobs(dest_dir: Path) -> List[dict]:
    rows = []
    jobs_dir = dest_dir / "jobs"
    if not jobs_dir.is_dir():
        return rows
    for path in jobs_dir.glob("*.json"):
        rows.append(json.loads(path.read_text(encoding="utf-8")))
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return rows


def _append_log(dest_dir: Path, job: Job, event: str, reused_from: str) -> None:
    line = {
        "at": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "job": job.id,
        "slug": getattr(job, "slug", "") or "",
        "reused_from": reused_from,
    }
    refuse_secret_payload(json.dumps(line))
    log = dest_dir / "log.jsonl"
    with log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line) + "\n")
