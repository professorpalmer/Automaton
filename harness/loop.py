from __future__ import annotations

"""Operator loop: long full-auto, report back, then screenshot steer."""

from pathlib import Path
from typing import Iterable, Optional, Tuple

from harness.factory import WAVE_NAMES, parse_spec, product_index, ship_wave, spec_wave, verify_wave
from harness.gates import FLOOR_MODEL
from harness.jobs import Job, JobStore
from harness.receipts import from_usage
from harness.budget import assert_can_bill
from harness.steer import apply_steer
from harness.vision import PreparedVision, Sidecar, VisionResult, accept_image, prepare_for_workhorse
from harness.wiki_job import write_job_page

ImageIn = Tuple[bytes, str, str]


def _prepare_images(
    store: JobStore,
    job: Job,
    images: Iterable[ImageIn],
    root: Optional[Path],
    sidecar: Optional[Sidecar],
) -> Optional[PreparedVision]:
    attachments = []
    for payload, filename, mime in images:
        record = accept_image(
            payload,
            filename=filename,
            mime=mime,
            job_id=job.id,
            root=root,
        )
        store.accept_image(job, record)
        attachments.append(record)
    if not attachments:
        return None
    prepared = prepare_for_workhorse(
        attachments,
        workhorse_model=FLOOR_MODEL,
        sidecar=sidecar,
    )
    for result in prepared.results:
        store.add_receipt(
            job,
            from_usage(
                model=result.model or "vision-sidecar",
                completion_tokens=result.tokens_out,
                provider_cost=result.cost_usd,
            ),
        )
    return prepared


def run_full_auto(
    brief: str,
    images: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    title: str = "",
) -> Job:
    store = JobStore(root)
    job = store.create(brief, title=title or parse_spec(brief).title)
    store.start_full_auto(job, WAVE_NAMES)
    sidecar_text = None
    try:
        prepared = _prepare_images(store, job, images or [], root, sidecar)
        if prepared is not None:
            sidecar_text = prepared.sidecar_text
        spec = spec_wave(store, job, sidecar_text)
        dest = ship_wave(store, job, spec, root)
        verify_wave(store, job, spec, dest)
        rel = f"tenant/products/{job.id}/index.html"
        store.report_back(
            job,
            "The tool is ready. Open it, then tell me what to change — a screenshot is enough.",
            rel,
        )
        write_job_page(job, root)
    except Exception as exc:
        if job.waves and any(wave.status == "running" for wave in job.waves):
            running = next(wave.name for wave in job.waves if wave.status == "running")
            store.fail_wave(job, running, str(exc))
        else:
            job.status = "failed"
            job.report = str(exc)
            store.save(job)
        raise
    return store.get(job.id)


def run_steer(
    job_id: str,
    instruction: str,
    images: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    opener=None,
) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    store.begin_steer(job)
    prepared = _prepare_images(store, job, images or [], root, sidecar)
    text = instruction.strip()
    sidecar_text = prepared.sidecar_text if prepared else None
    if sidecar_text:
        text = f"{text}\n\nFrom the screenshot: {sidecar_text}"
    assert_can_bill(job.receipts, root)
    note = apply_steer(job, text, root, sidecar_text=sidecar_text, opener=opener)
    dest = product_index(job, root)
    if not dest.is_file():
        raise RuntimeError("steer wrote nothing")
    job.report = f"Changed: {note}."
    store.save(job)
    write_job_page(job, root)
    return store.get(job.id)


class ScriptedSidecar:
    """Test double. Live path uses TenantOpenRouterSidecar."""

    name = "scripted-vlm"

    def __init__(self, text: str, error: Optional[str] = None) -> None:
        self.text = text
        self.error = error

    def transcribe(self, image_path: str) -> VisionResult:
        return VisionResult(text=self.text, model=self.name, error=self.error)
