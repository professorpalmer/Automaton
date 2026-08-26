from __future__ import annotations

"""Put a box project on the tenant's Render. Never the host operator account."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from harness.gates import (
    TENANT_RENDER_KEY_ENV,
    TENANT_RENDER_KEY_ENV_LEGACY,
    TENANT_RENDER_KEY_FILENAME,
    env_get,
)
from harness.jobs import Job
from harness.paths import secrets_dir
from harness.projects import project_dir
from harness.vault import VaultError, assert_not_wiki, refuse_secret_payload


@dataclass
class DeployResult:
    ok: bool
    url: str = ""
    need: str = ""
    ask: str = ""


class ScriptedHost:
    """Test double. Live path uses RenderHost."""

    def __init__(self, url: str = "https://sa-tool.onrender.com") -> None:
        self.url = url

    def deploy(self, slug: str, dest: Path, repo_url: str = "") -> DeployResult:
        return DeployResult(ok=True, url=self.url)


def render_key_path(root: Optional[Path] = None) -> Path:
    return secrets_dir(root) / TENANT_RENDER_KEY_FILENAME


def load_tenant_render_key(
    root: Optional[Path] = None,
    environ: Optional[dict] = None,
) -> Optional[str]:
    env = environ if environ is not None else os.environ
    from_env = env_get(env, TENANT_RENDER_KEY_ENV, TENANT_RENDER_KEY_ENV_LEGACY)
    if from_env:
        return from_env
    path = render_key_path(root)
    if not path.is_file():
        return None
    assert_not_wiki(path)
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def write_tenant_render_key(key: str, root: Optional[Path] = None) -> Path:
    dest = render_key_path(root)
    assert_not_wiki(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cleaned = (key or "").strip()
    if not cleaned:
        raise VaultError("refusing to write an empty Render key")
    dest.write_text(cleaned + "\n", encoding="utf-8")
    dest.chmod(0o600)
    return dest


def is_render_key_file(filename: str, payload: bytes) -> bool:
    name = (filename or "").lower()
    if "render" in name and name.endswith((".key", ".txt")):
        return True
    try:
        text = payload.decode("utf-8").strip()
    except UnicodeDecodeError:
        return False
    return text.startswith("rnd_")


def deploy_project(
    job: Job,
    dest: Path,
    root: Optional[Path] = None,
    client: Optional[object] = None,
) -> DeployResult:
    key = load_tenant_render_key(root)
    repo_url = _repo_url(job, dest, root)
    if client is not None:
        try:
            return client.deploy(job.slug or job.id, dest, repo_url)
        except Exception:
            return DeployResult(
                ok=False,
                ask="I could not put that live. The local tool is still up.",
            )
    if not key:
        return DeployResult(
            ok=False,
            need="render_key",
            ask="I can put it on Render when you drop a Render API key.",
        )
    host = RenderHost(key)
    try:
        return host.deploy(job.slug or job.id, dest, repo_url)
    except Exception:
        return DeployResult(
            ok=False,
            ask="I could not reach Render. The local tool is still up.",
        )


def _repo_url(job: Job, dest: Path, root: Optional[Path]) -> str:
    for folder in (dest, project_dir(job.slug, root) if job.slug else None):
        if folder is None:
            continue
        env_path = folder / "env.json"
        if not env_path.is_file():
            continue
        try:
            payload = json.loads(env_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        url = str(payload.get("repo") or payload.get("render_repo") or "").strip()
        if url.startswith("https://"):
            return url
    return ""


class RenderHost:
    def __init__(self, key: str) -> None:
        self.key = key

    def deploy(self, slug: str, dest: Path, repo_url: str = "") -> DeployResult:
        service = self._find(slug)
        if service is None:
            if not repo_url:
                return DeployResult(
                    ok=False,
                    need="render_service",
                    ask="I have the Render key. Name the existing service in the project env, or add a GitHub repo URL.",
                )
            return DeployResult(
                ok=False,
                need="render_service",
                ask="I have the key and repo. Create the Render service once, then I can keep deploying it.",
            )
        self._trigger(service["id"])
        url = service.get("url") or ""
        refuse_secret_payload(url)
        return DeployResult(ok=bool(url), url=url)

    def _find(self, slug: str) -> Optional[dict]:
        rows = self._get("/v1/services?limit=50")
        if not isinstance(rows, list):
            return None
        wanted = (slug or "").lower()
        for row in rows:
            service = row.get("service") if isinstance(row, dict) else None
            if not isinstance(service, dict):
                continue
            name = str(service.get("name") or "").lower()
            if name != wanted and not name.endswith(wanted):
                continue
            details = service.get("serviceDetails") or {}
            return {
                "id": service.get("id") or "",
                "url": str(details.get("url") or ""),
            }
        return None

    def _trigger(self, service_id: str) -> None:
        self._post(f"/v1/services/{service_id}/deploys", {})

    def _get(self, path: str):
        return self._call("GET", path, None)

    def _post(self, path: str, payload: dict):
        return self._call("POST", path, payload)

    def _call(self, method: str, path: str, payload: Optional[dict]):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            "https://api.render.com" + path,
            data=body,
            method=method,
            headers={
                "Authorization": "Bearer " + self.key,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError, OSError):
            return None
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
