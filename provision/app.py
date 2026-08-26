from __future__ import annotations

import argparse
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from harness.gates import env_get
from harness.vault import VaultError
from provision.inquiries import InquiryError, InquiryStore
from provision.spec import StampError
from provision.stamp import stamp_box, update_box
from provision.store import BoxStore, host_root

HOST_TOKEN_ENV = "AUTOMATON_HOST_TOKEN"
HOST_ROOT_ENV = "AUTOMATON_HOST_ROOT"
PROVISION_DIR = Path(__file__).resolve().parent
STATIC_DIR = PROVISION_DIR / "static"


def create_app(root: Path | None = None, client: object | None = None, token: str | None = None) -> FastAPI:
    workspace = Path(root) if root is not None else _default_root()
    required = (token if token is not None else env_get(os.environ, HOST_TOKEN_ENV)).strip()
    app = FastAPI(title="Automaton", docs_url=None, redoc_url=None)

    def _guard(authorization: str = "") -> None:
        if not required:
            return
        got = (authorization or "").strip()
        if got.startswith("Bearer "):
            got = got[7:].strip()
        if got != required:
            raise HTTPException(401, "host token required")

    @app.get("/", response_class=HTMLResponse)
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/admin", response_class=HTMLResponse)
    def admin() -> FileResponse:
        return FileResponse(STATIC_DIR / "admin.html")

    @app.get("/api/status")
    def status() -> dict:
        return {"product": "Automaton", "ok": True}

    @app.post("/api/inquiries")
    async def create_inquiry(request: Request) -> dict:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(400, "send a JSON object")
        try:
            row = InquiryStore(workspace).add(
                org=str(payload.get("org") or ""),
                name=str(payload.get("name") or ""),
                email=str(payload.get("email") or ""),
                note=str(payload.get("note") or ""),
            )
        except (InquiryError, VaultError) as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"ok": True, "id": row.id}

    @app.get("/api/inquiries")
    def list_inquiries(authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        return {"inquiries": [row.public() for row in InquiryStore(workspace).list_inquiries()]}

    @app.get("/api/boxes")
    def list_boxes(authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        return {"boxes": [box.public() for box in BoxStore(workspace).list_boxes()]}

    @app.get("/api/boxes/{slug}")
    def get_box(slug: str, authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        record = BoxStore(workspace).get(slug)
        if record is None:
            raise HTTPException(404, "no box with that org slug")
        return record.public()

    @app.post("/api/boxes")
    async def create_box(request: Request, authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(400, "send a JSON object")
        try:
            record = stamp_box(payload, root=workspace, client=client)
        except StampError as exc:
            raise HTTPException(400, str(exc)) from exc
        return record.public()

    @app.post("/api/boxes/{slug}/update")
    async def refresh_box(slug: str, request: Request, authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        payload = await request.json()
        if not isinstance(payload, dict):
            payload = {}
        try:
            record = update_box(
                slug,
                root=workspace,
                client=client,
                render_api_key=str(payload.get("render_api_key") or ""),
                image=str(payload.get("image") or ""),
                branch=str(payload.get("branch") or ""),
                extras=payload.get("extras") if isinstance(payload.get("extras"), dict) else None,
            )
        except StampError as exc:
            raise HTTPException(400, str(exc)) from exc
        return record.public()

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


def _default_root() -> Path:
    override = env_get(os.environ, HOST_ROOT_ENV)
    if override:
        return Path(override)
    return host_root()


app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="Automaton — public site and host admin")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run("provision.app:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
