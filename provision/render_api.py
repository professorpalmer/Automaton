from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from provision.seed import BUILD_COMMAND, START_COMMAND, disk_for, seed_env
from provision.spec import BoxSpec


@dataclass
class BoxLive:
    ok: bool
    service_id: str = ""
    url: str = ""
    need: str = ""
    ask: str = ""


@dataclass
class ScriptedRender:
    """Test double. Live path uses RenderBoxClient with their key."""

    url_template: str = "https://{name}.onrender.com"
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    deployed: list[str] = field(default_factory=list)

    def create(self, spec: BoxSpec, env: Optional[list[dict[str, str]]] = None) -> BoxLive:
        self.created.append(spec.service_name)
        return BoxLive(
            ok=True,
            service_id="srv_" + spec.slug,
            url=self.url_template.format(name=spec.service_name),
        )

    def update(self, service_id: str, spec: BoxSpec, env: Optional[list[dict[str, str]]] = None) -> BoxLive:
        self.updated.append(service_id)
        self.deployed.append(service_id)
        return BoxLive(
            ok=True,
            service_id=service_id,
            url=self.url_template.format(name=spec.service_name),
        )


class RenderBoxClient:
    """Create and update Automaton boxes on the client's Render account."""

    def __init__(self, key: str) -> None:
        self.key = (key or "").strip()

    def create(self, spec: BoxSpec, env: Optional[list[dict[str, str]]] = None) -> BoxLive:
        if not self.key:
            return BoxLive(ok=False, need="render_key", ask="Their Render API key is required.")
        existing = self._find(spec.service_name)
        rows = env if env is not None else seed_env(spec)
        if existing is not None:
            return self.update(existing["id"], spec, rows)
        owner = self._owner_id()
        if not owner:
            return BoxLive(
                ok=False,
                need="render_owner",
                ask="I could not read their Render workspace. Check the API key.",
            )
        payload = self._create_payload(spec, owner, rows)
        created = self._post("/v1/services", payload)
        service = _unwrap_service(created)
        if service is None:
            return BoxLive(
                ok=False,
                need="render_create",
                ask="Render did not create the Automaton service. Their repo access or plan may be missing.",
            )
        return BoxLive(ok=True, service_id=service["id"], url=service["url"])

    def update(self, service_id: str, spec: BoxSpec, env: Optional[list[dict[str, str]]] = None) -> BoxLive:
        rows = env if env is not None else seed_env(spec)
        self._put(f"/v1/services/{service_id}/env-vars", rows)
        self._post(f"/v1/services/{service_id}/deploys", {})
        found = self._find_id(service_id) or self._find(spec.service_name)
        url = (found or {}).get("url") or ""
        return BoxLive(ok=bool(service_id), service_id=service_id, url=url)

    def _create_payload(self, spec: BoxSpec, owner_id: str, env: list[dict[str, str]]) -> dict:
        details: dict = {
            "runtime": "image" if spec.image else "python",
            "plan": spec.plan,
            "region": spec.region,
            "healthCheckPath": "/api/status",
            "disk": disk_for(spec),
        }
        if not spec.image:
            details["envSpecificDetails"] = {
                "buildCommand": BUILD_COMMAND,
                "startCommand": START_COMMAND,
            }
        payload: dict = {
            "type": "web_service",
            "name": spec.service_name,
            "ownerId": owner_id,
            "autoDeploy": "no",
            "envVars": env,
            "serviceDetails": details,
        }
        if spec.image:
            payload["image"] = {"url": spec.image}
        else:
            payload["repo"] = spec.repo
            payload["branch"] = spec.branch
        return payload

    def _owner_id(self) -> str:
        rows = self._get("/v1/owners")
        if not isinstance(rows, list):
            return ""
        for row in rows:
            owner = row.get("owner") if isinstance(row, dict) else None
            if isinstance(owner, dict) and owner.get("id"):
                return str(owner["id"])
            if isinstance(row, dict) and row.get("id"):
                return str(row["id"])
        return ""

    def _find(self, name: str) -> Optional[dict]:
        rows = self._get("/v1/services?limit=50")
        if not isinstance(rows, list):
            return None
        wanted = (name or "").lower()
        for row in rows:
            service = _unwrap_service(row)
            if service is None:
                continue
            if str(service.get("name") or "").lower() == wanted:
                return service
        return None

    def _find_id(self, service_id: str) -> Optional[dict]:
        raw = self._get(f"/v1/services/{service_id}")
        return _unwrap_service(raw)

    def _get(self, path: str):
        return self._call("GET", path, None)

    def _post(self, path: str, payload: object):
        return self._call("POST", path, payload)

    def _put(self, path: str, payload: object):
        return self._call("PUT", path, payload)

    def _call(self, method: str, path: str, payload: Optional[object]):
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
            with urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            if exc.code in (401, 403):
                return None
            return None
        except (URLError, TimeoutError, OSError):
            return None
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None


def _unwrap_service(raw: object) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    service = raw.get("service") if isinstance(raw.get("service"), dict) else raw
    if not isinstance(service, dict):
        return None
    details = service.get("serviceDetails") or {}
    if not isinstance(details, dict):
        details = {}
    ident = str(service.get("id") or "")
    if not ident:
        return None
    return {
        "id": ident,
        "name": str(service.get("name") or ""),
        "url": str(details.get("url") or service.get("url") or ""),
    }
