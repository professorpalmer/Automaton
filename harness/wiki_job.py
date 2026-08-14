from __future__ import annotations

"""Job notes in the tenant wiki. Secrets never go here."""

from datetime import date
from pathlib import Path
from typing import Optional

from harness.jobs import Job
from harness.paths import tenant_wiki_dir
from harness.vault import refuse_secret_payload


def write_job_page(job: Job, root: Optional[Path] = None) -> Path:
    refuse_secret_payload(job.brief)
    refuse_secret_payload(job.report)
    dest_dir = tenant_wiki_dir(root)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{job.id}.md"
    waves = "\n".join(
        f"- {wave.name}: {wave.status} — {wave.evidence}" for wave in job.waves
    )
    body = (
        f"# {job.title}\n\n"
        f"Tenant job note. Not an official playbook.\n\n"
        f"## Brief\n\n{job.brief}\n\n"
        f"## Waves\n\n{waves}\n\n"
        f"## Product\n\n`{job.product_relpath}`\n\n"
        f"## Report\n\n{job.report}\n"
    )
    refuse_secret_payload(body)
    today = date.today().isoformat()
    page = (
        "---\n"
        f"title: {job.title}\n"
        "type: source\n"
        f"created: {today}\n"
        f"updated: {today}\n"
        "tags: [toyvendor, job]\n"
        "---\n\n"
        f"{body}"
    )
    dest.write_text(page, encoding="utf-8")
    return dest
