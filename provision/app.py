from __future__ import annotations

import argparse
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from harness.gates import env_get
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
    app = FastAPI(title="Automaton Host", docs_url=None, redoc_url=None)

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

    @app.get("/api/status")
    def status(authorization: str = Header(default="")) -> dict:
        _guard(authorization)
        boxes = BoxStore(workspace).list_boxes()
        return {
            "product": "Automaton Host",
            "boxes": len(boxes),
            "live": sum(1 for box in boxes if box.status == "live" and box.url),
        }

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
    parser = argparse.ArgumentParser(description="Automaton host — stamp client boxes")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run("provision.app:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
