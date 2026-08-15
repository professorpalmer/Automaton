from __future__ import annotations

"""Operator loop: long full-auto, report back, then screenshot steer."""

from pathlib import Path
from typing import Iterable, Optional, Tuple

from harness.attachments import accept_file
from harness.factory import (
    WAVE_NAMES,
    keep_operator_workbook,
    parse_spec,
    product_dir,
    product_index,
    ship_wave,
    spec_wave,
    verify_wave,
)
from harness.gates import FLOOR_MODEL, STATUS_INTAKE, STATUS_RUNNING
from harness.intake import (
    NEED_THINGS,
    SEALED,
    TEAM,
    YES,
    ask_text,
    closing_bubbles,
    intake_bubbles,
    keep_met,
    kind_of,
    merge_needs,
    needs_for,
    operator_said_done,
    operator_said_enough,
    operator_said_go,
    ready_to_build,
    still_ask,
    still_needed,
)
from harness.jobs import Job, JobError, JobStore
from harness.paths import repo_root
from harness.receipts import from_usage
from harness.budget import assert_can_bill
from harness.steer import apply_steer
from harness.vision import (
    PreparedVision,
    Sidecar,
    VisionResult,
    VisionUnusable,
    accept_image,
    prepare_for_workhorse,
)
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


def _take_files(
    store: JobStore,
    job: Job,
    uploads: Iterable[ImageIn],
    root: Optional[Path],
) -> list:
    images = []
    for payload, filename, mime in uploads:
        from harness.host import is_render_key_file, write_tenant_render_key

        if is_render_key_file(filename, payload):
            try:
                write_tenant_render_key(payload.decode("utf-8").strip(), root)
            except (UnicodeDecodeError, ValueError):
                continue
            continue
        if kind_of(filename, mime) == "image":
            record = accept_image(
                payload,
                filename=filename,
                mime=mime,
                job_id=job.id,
                root=root,
            )
            store.accept_image(job, record)
            images.append((payload, filename, mime))
        else:
            store.accept_file(
                job,
                accept_file(
                    payload,
                    filename=filename,
                    mime=mime,
                    job_id=job.id,
                    root=root,
                ),
            )
    return images


def open_request(
    brief: str,
    uploads: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    wait: bool = True,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    from harness.projects import (
        find_project,
        recall_bubbles,
        should_recall,
        slug_for,
        update_note,
    )

    if should_recall(brief):
        prior = find_project(store, brief)
        if prior is not None:
            _take_files(store, prior, uploads or [], root)
            extra = update_note(brief)
            if extra:
                return run_steer(prior.id, extra, root=root, sidecar=sidecar)
            prior.report = "\n\n".join(recall_bubbles(prior))
            store.save(prior)
            write_job_page(prior, root, event="recall")
            return store.get(prior.id)
    job = store.create(brief, title=parse_spec(brief).title)
    job.slug = slug_for(brief)
    store.save(job)
    _take_files(store, job, uploads or [], root)
    job = store.get(job.id)
    needs = needs_for(brief)
    job.needed = needs
    store.save(job)
    from harness.artifacts import sync_asks, write_handoff

    sync_asks(job)
    write_handoff(job, root, reason="open")
    store.save(job)
    if should_recall(brief) and not ready_to_build(needs, job, brief):
        bubbles = ["I do not have a project that matches that yet."] + intake_bubbles(
            brief, needs, job, first=True
        )
        store.open_intake(job, needs, "\n\n".join(bubbles))
        return store.get(job.id)
    if not ready_to_build(needs, job, brief):
        store.open_intake(
            job,
            needs,
            "\n\n".join(intake_bubbles(brief, needs, job, first=True)),
        )
        return store.get(job.id)
    launched = launch_build(job, None, root=root, sidecar=sidecar, wait=wait, host=host)
    if launched.status == STATUS_RUNNING:
        leftover = still_needed(launched.needed or needs, launched)
        lines = [YES]
        if leftover:
            lines.append(NEED_THINGS)
            lines.append(ask_text(brief, launched.needed or needs, launched))
        launched.report = "\n\n".join(lines)
        store.save(launched)
    return store.get(launched.id)


def continue_intake(
    job_id: str,
    note: str = "",
    uploads: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    wait: bool = True,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    if operator_said_done(note) and (job.product_relpath or job.live_url):
        return _seal(store, job, root)
    if job.status != STATUS_INTAKE:
        if job.product_relpath or job.status == STATUS_RUNNING:
            return accept_more(
                job_id, note, uploads, root=root, sidecar=sidecar, wait=wait, host=host
            )
        raise JobError("not waiting on files")
    if note.strip():
        job.brief = (job.brief + "\n" + note.strip()).strip()
        job.needed = merge_needs(job.needed, needs_for(job.brief))
        store.save(job)
    _take_files(store, job, uploads or [], root)
    job = store.get(job.id)
    needs = list(job.needed) if job.needed is not None else needs_for(job.brief)
    if operator_said_enough(note):
        needs = keep_met(needs, job)
    job.needed = needs
    job.ask_round = (job.ask_round or 0) + 1
    store.save(job)
    if ready_to_build(needs, job, note):
        return launch_build(job, None, root=root, sidecar=sidecar, wait=wait, host=host)
    job.report = ask_text(job.brief, needs, job)
    store.save(job)
    return store.get(job.id)


def accept_more(
    job_id: str,
    note: str = "",
    uploads: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    wait: bool = True,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    if operator_said_done(note) and (job.product_relpath or job.live_url):
        return _seal(store, job, root)
    if note.strip():
        job.brief = (job.brief + "\n" + note.strip()).strip()
        job.needed = merge_needs(job.needed, needs_for(job.brief))
        store.save(job)
    dropped = list(uploads or [])
    _take_files(store, job, dropped, root)
    job = store.get(job.id)
    needs = list(job.needed or [])
    if operator_said_enough(note):
        needs = keep_met(needs or needs_for(job.brief), job)
        job.needed = needs
        store.save(job)
    from harness.artifacts import record_worker, sync_asks, write_handoff

    job.ask_round = (job.ask_round or 0) + 1
    sync_asks(job)
    write_handoff(job, root, reason="drop")
    store.save(job)
    if job.status == STATUS_RUNNING:
        leftover = still_needed(job.needed or [], job)
        lines = [TEAM]
        if leftover:
            lines.append(ask_text(job.brief, job.needed or [], job))
        job.report = "\n\n".join(lines)
        store.save(job)
        return job
    if job.product_relpath:
        keep_operator_workbook(job, product_dir(job, root))
        if dropped:
            record_worker(job, "followup", "queued", root)
            store.save(job)
            if wait:
                return apply_followup(job.id, root=root, host=host)
            from harness.crew import spawn_build

            workspace = Path(root) if root is not None else repo_root()
            pid = spawn_build(job.id, workspace, followup=True)
            job.worker_pid = pid
            leftover = still_needed(job.needed or [], job)
            lines = [TEAM]
            if leftover:
                lines.append(ask_text(job.brief, job.needed or [], job))
            job.report = "\n\n".join(lines)
            store.save(job)
            return store.get(job.id)
        leftover = still_needed(needs, job)
        if leftover:
            job.report = "Got that.\n\n" + still_ask(leftover[0])
        else:
            job.report = "Got that. The tool can use it now."
        store.save(job)
        return store.get(job.id)
    raise JobError("not waiting on files")


def launch_build(
    job: Job,
    images: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    wait: bool = True,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    from harness.replay import fingerprint, try_reuse

    pending = list(images or [])
    if pending and isinstance(pending[0], tuple):
        _take_files(store, job, pending, root)
        job = store.get(job.id)
    job.replay_key = fingerprint(job.brief, job)
    store.save(job)
    reused = try_reuse(store, job, root)
    if reused is not None:
        return reused
    from harness.artifacts import record_worker, write_handoff

    record_worker(job, "build", "queued", root)
    write_handoff(job, root, reason="build")
    store.save(job)
    prepared = None
    if job.images:
        try:
            prepared = prepare_for_workhorse(
                job.images,
                workhorse_model=FLOOR_MODEL,
                sidecar=sidecar,
            )
        except VisionUnusable:
            if sidecar is not None:
                raise
            prepared = None
        if prepared is not None:
            for result in prepared.results:
                store.add_receipt(
                    job,
                    from_usage(
                        model=result.model or "vision-sidecar",
                        completion_tokens=result.tokens_out,
                        provider_cost=result.cost_usd,
                    ),
                )
    if prepared is not None and prepared.sidecar_text:
        job.vision_note = prepared.sidecar_text
        store.save(job)
    store.start_full_auto(job, WAVE_NAMES)
    if wait:
        return finish_build(job.id, root=root, host=host)
    from harness.crew import spawn_build

    workspace = Path(root) if root is not None else repo_root()
    pid = spawn_build(job.id, workspace)
    job = store.get(job.id)
    job.worker_pid = pid
    job.report = YES
    store.save(job)
    return store.get(job.id)


def finish_build(
    job_id: str,
    *,
    root: Optional[Path] = None,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    try:
        spec = spec_wave(store, job, job.vision_note or None)
        dest = ship_wave(store, job, spec, root)
        verify_wave(store, job, spec, dest)
        rel = _product_relpath(job, dest)
        from harness.projects import publish_repo, slug_for

        job.slug = job.slug or slug_for(job.title or job.brief)
        publish_repo(job, dest if dest.is_dir() else dest.parent, root)
        from harness.artifacts import record_worker, sync_asks, write_result
        from harness.host import deploy_project

        folder = dest if dest.is_dir() else dest.parent
        deployed = deploy_project(job, folder, root, client=host)
        job.live_url = deployed.url or job.live_url
        sync_asks(job)
        record_worker(job, "build", "done", root)
        write_result(job, root, extra={"need": deployed.need})
        store.save(job)
        report = "\n\n".join(closing_bubbles(job, spec, live_path=f"/product/{job.id}/"))
        if deployed.ask and deployed.ask not in report:
            report = report + "\n\n" + deployed.ask
        store.report_back(job, report, rel)
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


def apply_followup(
    job_id: str,
    *,
    root: Optional[Path] = None,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    job = store.get(job_id)
    dest = product_dir(job, root)
    keep_operator_workbook(job, dest)
    from harness.artifacts import record_worker, sync_asks, write_handoff, write_result
    from harness.host import deploy_project
    from harness.projects import publish_repo

    publish_repo(job, dest, root)
    deployed = deploy_project(job, dest, root, client=host)
    job.live_url = deployed.url or job.live_url
    sync_asks(job)
    record_worker(job, "followup", "done", root)
    write_handoff(job, root, reason="followup")
    write_result(job, root, extra={"need": deployed.need})
    leftover = still_needed(job.needed or [], job)
    lines = [TEAM, "Got that. The tool can use it now."]
    if any(getattr(record, "kind", "") == "workbook" for record in job.files):
        lines.append("I kept the workbook you dropped.")
    here = job.live_url or f"/product/{job.id}/"
    lines.append(f"It is available here at {here}.")
    if leftover:
        lines.append(still_ask(leftover[0]))
    elif deployed.ask:
        lines.append(deployed.ask)
    job.report = "\n\n".join(lines)
    store.save(job)
    write_job_page(job, root, event="followup")
    return store.get(job.id)


def _seal(store: JobStore, job: Job, root: Optional[Path]) -> Job:
    job.sealed = True
    job.report = SEALED
    store.finish(job)
    write_job_page(job, root, event="seal")
    return store.get(job.id)


def run_full_auto(
    brief: str,
    images: Optional[Iterable[ImageIn]] = None,
    *,
    root: Optional[Path] = None,
    sidecar: Optional[Sidecar] = None,
    title: str = "",
    job: Optional[Job] = None,
    host: Optional[object] = None,
) -> Job:
    store = JobStore(root)
    if job is None:
        from harness.projects import slug_for

        job = store.create(brief, title=title or parse_spec(brief).title)
        job.slug = slug_for(brief)
        store.save(job)
    return launch_build(job, images, root=root, sidecar=sidecar, wait=True, host=host)


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
    if operator_said_done(instruction) and not images:
        return _seal(store, job, root)
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
    from harness.projects import publish_repo

    publish_repo(job, dest.parent, root)
    store.save(job)
    write_job_page(job, root)
    return store.get(job.id)


def _product_relpath(job: Job, dest: Path) -> str:
    dest_dir = dest if dest.is_dir() else dest.parent
    name = "app.py" if (dest_dir / "app.py").is_file() else "index.html"
    from harness.paths import product_relpath

    return product_relpath(job.id, name)


class ScriptedSidecar:
    """Test double. Live path uses TenantOpenRouterSidecar."""

    name = "scripted-vlm"

    def __init__(self, text: str, error: Optional[str] = None) -> None:
        self.text = text
        self.error = error

    def transcribe(self, image_path: str) -> VisionResult:
        return VisionResult(text=self.text, model=self.name, error=self.error)
