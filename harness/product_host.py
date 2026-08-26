from __future__ import annotations

"""Load a shipped product app and serve it under /product/{id}/."""

import importlib.util
from pathlib import Path
from typing import Any, Optional

from fastapi.responses import FileResponse, Response
from starlette.requests import Request
from starlette.types import Message


def load_product_app(dest: Path):
    app_py = dest / "app.py"
    if not app_py.is_file():
        return None
    name = "automaton_product_" + dest.name.replace("-", "_")
    spec = importlib.util.spec_from_file_location(name, app_py)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, "app", None)


async def dispatch_product(inner: Any, prefix: str, request: Request) -> Response:
    scope = dict(request.scope)
    path = scope.get("path") or "/"
    if path.startswith(prefix):
        scope["path"] = path[len(prefix) :] or "/"
    scope["root_path"] = (scope.get("root_path") or "") + prefix.rstrip("/")
    status = 500
    headers = []
    chunks: list[bytes] = []

    async def send(message: Message) -> None:
        nonlocal status, headers
        if message["type"] == "http.response.start":
            status = int(message["status"])
            headers = list(message.get("headers") or [])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body") or b"")

    await inner(scope, request.receive, send)
    mapped = {}
    for key, value in headers:
        mapped[key.decode("latin-1")] = value.decode("latin-1")
    return Response(content=b"".join(chunks), status_code=status, headers=mapped)


def static_or_none(dest: Path) -> Optional[FileResponse]:
    index = dest / "index.html"
    if index.is_file():
        return FileResponse(index)
    return None
