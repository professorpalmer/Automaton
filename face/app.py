from __future__ import annotations

"""Chief of staff face. Infrastructure stays behind this door."""

import argparse
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request

from harness.box import ensure_box
from harness.doctor import doctor
from harness.jobs import JobError, JobStore
from harness.gates import STATUS_INTAKE
from harness.intake import required_still, still_needed
from harness.loop import continue_intake, open_request, run_steer
from harness.rewind import RewindError, can_undo, run_undo
from harness.paths import products_dir, repo_root
from harness.product_host import dispatch_product, load_product_app, static_or_none
from harness.receipts import job_spend_usd
from harness.vision import VisionUnusable

FACE_DIR = Path(__file__).resolve().parent
STATIC_DIR = FACE_DIR / "static"


def create_app(root: Path | None = None) -> FastAPI:
    if root is not None:
        workspace = Path(root)
    else:
        from harness.gates import ROOT_ENV, ROOT_ENV_LEGACY, env_get

        override = env_get(os.environ, ROOT_ENV, ROOT_ENV_LEGACY)
        workspace = Path(override) if override else repo_root()
    ensure_box(workspace)
    app = FastAPI(title="Automaton", docs_url=None, redoc_url=None)

    @app.get("/", response_class=HTMLResponse)
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/status")
    def status() -> dict:
        return doctor(workspace)

    @app.get("/api/jobs")
    def list_jobs() -> dict:
        jobs = JobStore(workspace).list_jobs()
        return {"jobs": [_public(job, workspace) for job in jobs]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        try:
            job = JobStore(workspace).get(job_id)
        except JobError as exc:
            raise HTTPException(404, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs")
    async def start_job(
        brief: str = Form(...),
        images: List[UploadFile] = File(default=[]),
        files: List[UploadFile] = File(default=[]),
    ) -> dict:
        payloads = await _read_uploads(images + files)
        try:
            job = open_request(brief, payloads, root=workspace, wait=False)
        except VisionUnusable as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs/{job_id}/continue")
    async def continue_job(
        job_id: str,
        note: str = Form(""),
        images: List[UploadFile] = File(default=[]),
        files: List[UploadFile] = File(default=[]),
    ) -> dict:
        payloads = await _read_uploads(images + files)
        try:
            job = continue_intake(job_id, note, payloads, root=workspace, wait=False)
        except VisionUnusable as exc:
            raise HTTPException(400, str(exc)) from exc
        except (JobError, Exception) as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs/{job_id}/ready")
    def mark_ready(job_id: str) -> dict:
        store = JobStore(workspace)
        try:
            job = store.mark_ready_for_check(store.get(job_id))
        except JobError as exc:
            raise HTTPException(404, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs/{job_id}/check")
    def check_job(job_id: str) -> dict:
        store = JobStore(workspace)
        try:
            job = store.maker_check(store.get(job_id))
        except JobError as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs/{job_id}/steer")
    async def steer_job(
        job_id: str,
        instruction: str = Form(""),
        images: List[UploadFile] = File(default=[]),
    ) -> dict:
        payloads = await _read_uploads(images)
        text = (instruction or "").strip()
        if not text and not payloads:
            raise HTTPException(400, "Add a sentence or a screenshot.")
        if not text:
            text = "Change the tool to match this screenshot."
        try:
            job = run_steer(job_id, text, payloads, root=workspace)
        except VisionUnusable as exc:
            raise HTTPException(400, str(exc)) from exc
        except (JobError, Exception) as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job, workspace)

    @app.post("/api/jobs/{job_id}/undo")
    def undo_job(job_id: str) -> dict:
        try:
            job = run_undo(job_id, root=workspace)
        except RewindError as exc:
            raise HTTPException(400, str(exc)) from exc
        except JobError as exc:
            raise HTTPException(404, str(exc)) from exc
        return _public(job, workspace)

    @app.api_route("/product/{job_id}/", methods=["GET", "POST"])
    @app.api_route("/product/{job_id}/{rest:path}", methods=["GET", "POST"])
    async def product(job_id: str, request: Request, rest: str = "") -> object:
        dest = products_dir(workspace) / job_id
        inner = load_product_app(dest)
        if inner is not None:
            return await dispatch_product(inner, f"/product/{job_id}", request)
        page = static_or_none(dest)
        if page is not None:
            return page
        raise HTTPException(404, "product not ready")

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


async def _read_uploads(uploads: List[UploadFile]) -> list:
    rows = []
    for upload in uploads:
        if not upload.filename:
            continue
        payload = await upload.read()
        if not payload:
            continue
        rows.append((payload, upload.filename, upload.content_type or "image/png"))
    return rows


def _public(job, root=None) -> dict:
    from harness.bubbles import bubbles_for_report

    leftover = still_needed(getattr(job, "needed", None) or [], job)
    blocking = required_still(getattr(job, "needed", None) or [], job)
    if "\n\n" in (job.report or "") or job.status == STATUS_INTAKE:
        bubbles = [part for part in (job.report or "").split("\n\n") if part.strip()]
    else:
        bubbles = bubbles_for_report(job.report, ask=job.brief)
    product_url = f"/product/{job.id}/" if job.product_relpath else ""
    live_url = getattr(job, "live_url", "") or ""
    return {
        "id": job.id,
        "title": job.title,
        "brief": job.brief,
        "phase": job.phase,
        "status": job.status,
        "report": job.report,
        "bubbles": bubbles,
        "waiting": job.status == STATUS_INTAKE
        or bool(product_url and blocking)
        or (job.status == "running" and bool(leftover)),
        "building": job.status == "running",
        "still_needed": leftover,
        "asks": [ask for ask in (getattr(job, "asks", None) or []) if ask.get("status") == "open"],
        "live_url": live_url,
        "sealed": bool(getattr(job, "sealed", False)),
        "product_url": product_url,
        "can_undo": can_undo(job, root),
        "images_accepted": len(job.images),
        "files_accepted": len(getattr(job, "files", []) or []),
        "official_playbook": job.is_official(),
        "spend_usd": job_spend_usd(job.receipts),
        "reused": any(getattr(row, "source", "") == "cache" for row in (job.receipts or [])),
        "recalled": (job.report or "").startswith("I have that one."),
        "slug": getattr(job, "slug", "") or "",
    }


app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="Automaton chief of staff")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--doctor", action="store_true")
    args = parser.parse_args()
    if args.doctor:
        import json

        print(json.dumps(doctor(), indent=2))
        return
    import uvicorn

    uvicorn.run("face.app:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
