from __future__ import annotations

"""Named tenant repos. Recall by what the operator said, not by job UUID."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from harness.gates import STATUS_DONE, STATUS_REPORT_BACK, STATUS_STEERING, tenant_slug
from harness.jobs import Job, JobError, JobStore
from harness.paths import catalog_dir, projects_dir
from harness.vault import refuse_secret_payload

RECALL = re.compile(
    r"\b(remember|come back to|that (old |same )?(project|tool|one)|"
    r"ideas? to update|we (already )?(built|had|made) that)\b",
    re.I,
)
_SPACE = re.compile(r"\s+")
_STOP = {
    "a",
    "an",
    "and",
    "build",
    "button",
    "come",
    "create",
    "for",
    "from",
    "had",
    "hey",
    "ideas",
    "make",
    "need",
    "of",
    "one",
    "page",
    "please",
    "project",
    "remember",
    "ship",
    "some",
    "that",
    "the",
    "this",
    "to",
    "tool",
    "update",
    "we",
    "with",
}
_ALIASES = (
    (re.compile(r"\b(transport|lyft|flix|reconcil)", re.I), "transport-recon"),
    (re.compile(r"\b(sa-hotb|hotb|homeofthebrave|home of the brave)\b", re.I), "sa-hotb"),
    (re.compile(r"\bwaitlist\b", re.I), "waitlist"),
    (re.compile(r"\b(donation|letter)\b", re.I), "letter-pack"),
)
_REUSABLE = (STATUS_REPORT_BACK, STATUS_STEERING, STATUS_DONE)
_SKIP_COPY = {".git", "exports"}


def should_recall(text: str) -> bool:
    return bool(RECALL.search(text or ""))


def slug_for(text: str) -> str:
    raw = text or ""
    for pattern, slug in _ALIASES:
        if pattern.search(raw):
            return slug
    words = [word for word in re.findall(r"[a-z0-9]+", raw.lower()) if word not in _STOP]
    return "-".join(words[:4]) or "operator-tool"


def project_relpath(slug: str) -> str:
    return f"tenant/{tenant_slug()}/projects/{slug}"


def project_dir(slug: str, root: Optional[Path] = None) -> Path:
    return projects_dir(root) / slug


def find_project(store: JobStore, utterance: str) -> Optional[Job]:
    wanted = slug_for(utterance)
    hits = []
    for job in store.list_jobs():
        if job.status not in _REUSABLE or not job.product_relpath:
            continue
        job_slug = job.slug or slug_for(f"{job.title} {job.brief}")
        if job_slug == wanted or wanted in (job.title or "").lower().replace(" ", "-"):
            hits.append(job)
    if hits:
        hits.sort(key=lambda job: job.updated_at or "", reverse=True)
        return hits[0]
    return _from_catalog(store, wanted)


_CHANGE = re.compile(
    r"\b(turn|change|rename|label|add|remove|move|color|button|green|blue|gold|"
    r"export|submit)\b",
    re.I,
)
_PROJECT_TALK = re.compile(
    r"\b(that|this|the)\s+\w+\s+(project|tool|one)\b|"
    r"\b(transportation|transport|waitlist|donation|letter|recon)\b|"
    r"\b(hey|hi|hello|we had some|some ideas)\b",
    re.I,
)


def update_note(text: str) -> str:
    leftover = RECALL.sub(" ", text or "")
    leftover = _PROJECT_TALK.sub(" ", leftover)
    leftover = _SPACE.sub(" ", leftover).strip(" .,?!")
    if len(leftover) < 8:
        return ""
    if re.search(r"\b(build|make|create|ship)\s+(a|an|the)\b", leftover, re.I):
        return ""
    if not _CHANGE.search(leftover):
        return ""
    return leftover


def recall_bubbles(job: Job) -> list[str]:
    url = job.live_url or f"/product/{job.id}/"
    return [
        "I have that one.",
        f"It is available here at {url}.",
        "What should we change?",
    ]


def publish_repo(job: Job, src: Path, root: Optional[Path] = None) -> Path:
    slug = job.slug or slug_for(job.title or job.brief)
    job.slug = slug
    dest = project_dir(slug, root)
    dest.mkdir(parents=True, exist_ok=True)
    src_dir = src if src.is_dir() else src.parent
    for item in src_dir.iterdir():
        if item.name in _SKIP_COPY:
            continue
        target = dest / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    job.project_relpath = project_relpath(slug)
    _ensure_env(dest, job)
    _ensure_git(dest)
    _commit(dest, f"Update {job.id}")
    return dest


def _from_catalog(store: JobStore, wanted: str) -> Optional[Job]:
    jobs = catalog_dir(store.root) / "jobs"
    if not jobs.is_dir():
        return None
    for path in sorted(jobs.glob("*.json"), reverse=True):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if row.get("slug") != wanted:
            continue
        try:
            job = store.get(str(row.get("id") or path.stem))
        except JobError:
            continue
        if job.status in _REUSABLE and job.product_relpath:
            return job
    return None


def _ensure_env(dest: Path, job: Job) -> None:
    path = dest / "env.json"
    current = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                current = loaded
        except (OSError, json.JSONDecodeError):
            current = {}
    current["slug"] = job.slug
    current["product_kind"] = "service" if (dest / "app.py").is_file() else "poster"
    current.setdefault("connected", {})
    payload = json.dumps(current, indent=2) + "\n"
    refuse_secret_payload(payload)
    path.write_text(payload, encoding="utf-8")


def _ensure_git(dest: Path) -> None:
    if (dest / ".git").is_dir():
        return
    _git(dest, "init")
    ignore = dest / ".gitignore"
    if not ignore.is_file():
        ignore.write_text("exports/\n*.key\n", encoding="utf-8")


def _commit(dest: Path, message: str) -> None:
    _git(dest, "add", "-A")
    probe = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(dest),
        capture_output=True,
        text=True,
        check=False,
        env=_git_env(),
    )
    if not (probe.stdout or "").strip():
        return
    _git(dest, "commit", "-m", message)


def _git(dest: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(dest),
        check=True,
        capture_output=True,
        env=_git_env(),
    )


def _git_env() -> dict:
    env = os.environ.copy()
    env["GIT_PAGER"] = "cat"
    env["PAGER"] = "cat"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_AUTHOR_NAME"] = "Automaton"
    env["GIT_AUTHOR_EMAIL"] = "automaton@local"
    env["GIT_COMMITTER_NAME"] = "Automaton"
    env["GIT_COMMITTER_EMAIL"] = "automaton@local"
    return env
