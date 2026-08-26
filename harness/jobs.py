from __future__ import annotations

"""Durable job machine: full-auto waves, then steer. JSON on disk."""

import json
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from harness.attachments import FileRecord
from harness.gates import (
    PHASE_FULL_AUTO,
    PHASE_INTAKE,
    PHASE_STEER,
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_INTAKE,
    STATUS_PENDING,
    STATUS_REPORT_BACK,
    STATUS_RUNNING,
    STATUS_STEERING,
    job_is_official_playbook,
)
from harness.box import ensure_box
from harness.paths import jobs_dir
from harness.vault import refuse_secret_payload


class JobError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Wave:
    name: str
    status: str = "pending"
    evidence: str = ""
    started_at: str = ""
    ended_at: str = ""

    def start(self) -> None:
        self.status = "running"
        self.started_at = self.started_at or _now()

    def pass_(self, evidence: str) -> None:
        refuse_secret_payload(evidence)
        self.status = "passed"
        self.evidence = evidence
        self.ended_at = _now()

    def fail(self, evidence: str) -> None:
        refuse_secret_payload(evidence)
        self.status = "failed"
        self.evidence = evidence
        self.ended_at = _now()


@dataclass
class ImageRecord:
    id: str
    path: str
    mime: str
    bytes: int
    accepted_at: str
    dropped: bool = False


@dataclass
class Receipt:
    source: str
    model: str
    cost_usd: Optional[float]
    prompt_tokens: int = 0
    completion_tokens: int = 0
    note: str = ""


@dataclass
class Job:
    id: str
    title: str
    brief: str
    phase: str = PHASE_FULL_AUTO
    status: str = STATUS_PENDING
    waves: List[Wave] = field(default_factory=list)
    images: List[ImageRecord] = field(default_factory=list)
    files: List[FileRecord] = field(default_factory=list)
    needed: List[dict] = field(default_factory=list)
    receipts: List[Receipt] = field(default_factory=list)
    product_relpath: str = ""
    project_relpath: str = ""
    slug: str = ""
    vision_note: str = ""
    worker_pid: int = 0
    ask_round: int = 0
    replay_key: str = ""
    live_url: str = ""
    sealed: bool = False
    asks: List[dict] = field(default_factory=list)
    crew: List[dict] = field(default_factory=list)
    official_playbook: bool = False
    maker_checked: bool = False
    report: str = ""
    created_at: str = ""
    updated_at: str = ""

    def is_official(self) -> bool:
        return job_is_official_playbook(self.official_playbook, self.maker_checked)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Job":
        payload = dict(data)
        payload["waves"] = [Wave(**row) for row in payload.get("waves") or []]
        payload["images"] = [ImageRecord(**row) for row in payload.get("images") or []]
        payload["files"] = [FileRecord(**row) for row in payload.get("files") or []]
        payload["receipts"] = [Receipt(**row) for row in payload.get("receipts") or []]
        payload["needed"] = list(payload.get("needed") or [])
        payload["asks"] = list(payload.get("asks") or [])
        payload["crew"] = list(payload.get("crew") or [])
        allowed = {item.name for item in fields(cls)}
        return cls(**{key: value for key, value in payload.items() if key in allowed})


class JobStore:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root) if root is not None else None
        ensure_box(self.root)
        self.directory = jobs_dir(self.root)
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, job_id: str) -> Path:
        return self.directory / f"{job_id}.json"

    def create(self, brief: str, title: str = "") -> Job:
        refuse_secret_payload(brief)
        refuse_secret_payload(title)
        now = _now()
        job = Job(
            id=str(uuid.uuid4()),
            title=(title or brief).strip()[:80] or "Untitled job",
            brief=brief.strip(),
            created_at=now,
            updated_at=now,
        )
        self.save(job)
        return job

    def save(self, job: Job) -> None:
        refuse_secret_payload(job.brief)
        refuse_secret_payload(job.report)
        job.updated_at = _now()
        path = self._path(job.id)
        path.write_text(json.dumps(job.to_dict(), indent=2) + "\n", encoding="utf-8")

    def get(self, job_id: str) -> Job:
        path = self._path(job_id)
        if not path.is_file():
            raise JobError(f"unknown job {job_id}")
        return Job.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def list_jobs(self) -> List[Job]:
        rows = []
        for path in sorted(self.directory.glob("*.json"), reverse=True):
            rows.append(Job.from_dict(json.loads(path.read_text(encoding="utf-8"))))
        return rows

    def accept_image(self, job: Job, record: ImageRecord) -> Job:
        if record.dropped:
            raise JobError("images must never be dropped")
        job.images.append(record)
        self.save(job)
        return job

    def accept_file(self, job: Job, record: FileRecord) -> Job:
        if record.dropped:
            raise JobError("files must never be dropped")
        job.files.append(record)
        self.save(job)
        return job

    def open_intake(self, job: Job, needed: List[dict], report: str) -> Job:
        refuse_secret_payload(report)
        job.phase = PHASE_INTAKE
        job.status = STATUS_INTAKE
        job.needed = needed
        job.report = report
        self.save(job)
        return job

    def start_full_auto(self, job: Job, wave_names: List[str]) -> Job:
        if job.product_relpath or job.phase == PHASE_STEER:
            raise JobError("full-auto already finished; use steer")
        job.phase = PHASE_FULL_AUTO
        job.status = STATUS_RUNNING
        job.waves = [Wave(name=name) for name in wave_names]
        self.save(job)
        return job

    def begin_wave(self, job: Job, name: str) -> Wave:
        wave = _wave(job, name)
        if job.status not in (STATUS_RUNNING, STATUS_PENDING):
            raise JobError("waves only run during full-auto")
        wave.start()
        self.save(job)
        return wave

    def pass_wave(self, job: Job, name: str, evidence: str) -> Job:
        wave = _wave(job, name)
        wave.pass_(evidence)
        self.save(job)
        return job

    def fail_wave(self, job: Job, name: str, evidence: str) -> Job:
        wave = _wave(job, name)
        wave.fail(evidence)
        job.status = STATUS_FAILED
        self.save(job)
        return job

    def report_back(self, job: Job, report: str, product_relpath: str) -> Job:
        if any(wave.status != "passed" for wave in job.waves):
            raise JobError("cannot report back until every wave passed")
        refuse_secret_payload(report)
        job.report = report
        job.product_relpath = product_relpath
        job.status = STATUS_REPORT_BACK
        job.phase = PHASE_STEER
        self.save(job)
        return job

    def begin_steer(self, job: Job) -> Job:
        if job.status not in (STATUS_REPORT_BACK, STATUS_STEERING, STATUS_DONE):
            raise JobError("steer starts after report-back")
        job.phase = PHASE_STEER
        job.status = STATUS_STEERING
        self.save(job)
        return job

    def finish(self, job: Job) -> Job:
        job.status = STATUS_DONE
        self.save(job)
        return job

    def mark_ready_for_check(self, job: Job) -> Job:
        job.official_playbook = True
        self.save(job)
        return job

    def maker_check(self, job: Job) -> Job:
        if not job.official_playbook:
            raise JobError("maker must mark the job ready before checker sign-off")
        job.maker_checked = True
        self.save(job)
        return job

    def add_receipt(self, job: Job, receipt: Receipt) -> Job:
        if receipt.cost_usd is None and receipt.source == "unknown":
            # Keep the unknown; never invent $0.
            pass
        job.receipts.append(receipt)
        self.save(job)
        return job


def _wave(job: Job, name: str) -> Wave:
    for wave in job.waves:
        if wave.name == name:
            return wave
    raise JobError(f"unknown wave {name}")
