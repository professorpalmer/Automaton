from __future__ import annotations

"""Chief of staff face. Infrastructure stays behind this door."""

import argparse
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from harness.jobs import JobError, JobStore
from harness.loop import run_full_auto, run_steer
from harness.paths import products_dir, repo_root
from harness.receipts import job_spend_usd
from harness.vision import VisionUnusable

FACE_DIR = Path(__file__).resolve().parent
STATIC_DIR = FACE_DIR / "static"


def create_app(root: Path | None = None) -> FastAPI:
    if root is not None:
        workspace = Path(root)
    else:
        override = (os.environ.get("TOYVENDOR_ROOT") or "").strip()
        workspace = Path(override) if override else repo_root()
    app = FastAPI(title="ToyVendor", docs_url=None, redoc_url=None)

    @app.get("/", response_class=HTMLResponse)
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/jobs")
    def list_jobs() -> dict:
        jobs = JobStore(workspace).list_jobs()
        return {"jobs": [_public(job) for job in jobs]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        try:
            job = JobStore(workspace).get(job_id)
        except JobError as exc:
            raise HTTPException(404, str(exc)) from exc
        return _public(job)

    @app.post("/api/jobs")
    async def start_job(
        brief: str = Form(...),
        images: List[UploadFile] = File(default=[]),
    ) -> dict:
        payloads = await _read_images(images)
        try:
            job = run_full_auto(brief, payloads, root=workspace)
        except VisionUnusable as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job)

    @app.post("/api/jobs/{job_id}/steer")
    async def steer_job(
        job_id: str,
        instruction: str = Form(...),
        images: List[UploadFile] = File(default=[]),
    ) -> dict:
        payloads = await _read_images(images)
        try:
            job = run_steer(job_id, instruction, payloads, root=workspace)
        except VisionUnusable as exc:
            raise HTTPException(400, str(exc)) from exc
        except (JobError, Exception) as exc:
            raise HTTPException(400, str(exc)) from exc
        return _public(job)

    @app.get("/product/{job_id}/")
    def product(job_id: str) -> FileResponse:
        dest = products_dir(workspace) / job_id / "index.html"
        if not dest.is_file():
            raise HTTPException(404, "product not ready")
        return FileResponse(dest)

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


async def _read_images(uploads: List[UploadFile]) -> list:
    rows = []
    for upload in uploads:
        if not upload.filename:
            continue
        payload = await upload.read()
        if not payload:
            continue
        rows.append((payload, upload.filename, upload.content_type or "image/png"))
    return rows


def _public(job) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "brief": job.brief,
        "phase": job.phase,
        "status": job.status,
        "report": job.report,
        "product_url": f"/product/{job.id}/" if job.product_relpath else "",
        "images_accepted": len(job.images),
        "official_playbook": job.is_official(),
        "spend_usd": job_spend_usd(job.receipts),
        "waves": [
            {"name": wave.name, "status": wave.status, "evidence": wave.evidence}
            for wave in job.waves
        ],
    }


app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="ToyVendor chief of staff")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run("face.app:app", host=args.host, port=args.port, reload=False)
