from __future__ import annotations

"""Second identical job is a cache hit. $0 only when a product is reused."""

import hashlib
import re
import shutil
from typing import Optional

from harness.factory import product_dir
from harness.gates import STATUS_DONE, STATUS_REPORT_BACK, STATUS_STEERING
from harness.jobs import Job, JobStore
from harness.receipts import from_cache

_SPACE = re.compile(r"\s+")
_REUSABLE = (STATUS_REPORT_BACK, STATUS_STEERING, STATUS_DONE)


def normalize_brief(brief: str) -> str:
    return _SPACE.sub(" ", (brief or "").strip().lower())


def _blob_token(name: str, path: str) -> str:
    from pathlib import Path

    digest = ""
    src = Path(path) if path else None
    if src is not None and src.is_file():
        digest = hashlib.sha256(src.read_bytes()).hexdigest()[:16]
    return f"{(name or '').lower()}:{digest}"


def fingerprint(brief: str, job: Optional[Job] = None) -> str:
    parts = [normalize_brief(brief)]
    if job is not None:
        parts.append((getattr(job, "vision_note", "") or "").strip())
        parts.extend(
            sorted(_blob_token(record.name, record.path) for record in job.files)
        )
        parts.extend(
            sorted(
                _blob_token(
                    (record.path or "").rsplit("/", 1)[-1],
                    record.path,
                )
                for record in job.images
            )
        )
    raw = "\n".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def find_prior(store: JobStore, key: str, skip_id: str) -> Optional[Job]:
    if not key:
        return None
    for other in store.list_jobs():
        if other.id == skip_id:
            continue
        if other.replay_key != key:
            continue
        if other.status not in _REUSABLE or not other.product_relpath:
            continue
        src = product_dir(other, store.root)
        if (src / "index.html").is_file() or (src / "app.py").is_file():
            return other
    return None


def reuse_product(store: JobStore, job: Job, prior: Job, root=None) -> Job:
    src = product_dir(prior, root)
    dest = product_dir(job, root)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    job.replay_key = prior.replay_key
    job.slug = prior.slug or job.slug
    job.live_url = prior.live_url or job.live_url
    if prior.needed and not job.needed:
        job.needed = list(prior.needed)
    store.add_receipt(
        job,
        from_cache(note=f"reused {prior.id}"),
    )
    from harness.intake import closing_bubbles
    from harness.wiki_job import write_job_page

    dest = product_dir(job, root)
    from harness.paths import product_relpath
    from harness.projects import publish_repo

    publish_repo(job, dest, root)
    rel = product_relpath(job.id, "app.py" if (dest / "app.py").is_file() else "index.html")
    report = "\n\n".join(
        closing_bubbles(job, live_path=f"/product/{job.id}/", reused=True)
    )
    store.report_back(job, report, rel)
    write_job_page(job, root, reused_from=prior.id)
    return store.get(job.id)


def try_reuse(store: JobStore, job: Job, root=None) -> Optional[Job]:
    key = job.replay_key or fingerprint(job.brief, job)
    job.replay_key = key
    store.save(job)
    prior = find_prior(store, key, job.id)
    if prior is None:
        return None
    return reuse_product(store, job, prior, root)
