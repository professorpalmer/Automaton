from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Optional

from provision.render_api import RenderBoxClient
from provision.spec import BoxRecord, BoxSpec, StampError, spec_from_payload
from provision.store import BoxStore
from provision.seed import seed_env


def stamp_box(
    spec: BoxSpec | Mapping[str, object],
    *,
    root: Optional[Path] = None,
    client: Optional[object] = None,
) -> BoxRecord:
    if not isinstance(spec, BoxSpec):
        spec = spec_from_payload(spec)
    store = BoxStore(root)
    existing = store.get(spec.slug)
    env = seed_env(spec)
    host = client if client is not None else RenderBoxClient(spec.render_api_key)
    if existing and existing.service_id:
        live = host.update(existing.service_id, spec, env)
    else:
        live = host.create(spec, env)
    record = BoxRecord(
        slug=spec.slug,
        display=spec.display,
        service_id=live.service_id or (existing.service_id if existing else ""),
        url=live.url,
        repo=spec.repo,
        branch=spec.branch,
        image=spec.image,
        status="live" if live.ok and live.url else "failed",
        need=live.need,
        ask=live.ask,
        updated_at=_now(),
    )
    if live.ok and live.url:
        record.status = "live"
        record.need = ""
        record.ask = ""
    elif live.ok:
        record.status = "live"
    store.save(record)
    store.save_render_key(spec.slug, spec.render_api_key)
    return record


def update_box(
    slug: str,
    *,
    root: Optional[Path] = None,
    client: Optional[object] = None,
    render_api_key: str = "",
    image: str = "",
    branch: str = "",
    extras: Optional[Mapping[str, str]] = None,
) -> BoxRecord:
    store = BoxStore(root)
    existing = store.get(slug)
    if existing is None:
        raise StampError("no box with that org slug")
    key = (render_api_key or "").strip() or store.load_render_key(slug)
    if not key:
        existing.status = "failed"
        existing.need = "render_key"
        existing.ask = "I need their Render API key again to push an update."
        existing.updated_at = _now()
        store.save(existing)
        return existing
    spec = BoxSpec(
        slug=existing.slug,
        display=existing.display,
        render_api_key=key,
        repo=existing.repo,
        branch=(branch or existing.branch),
        image=(image or existing.image),
        extras=dict(extras or {}),
    )
    host = client if client is not None else RenderBoxClient(key)
    return stamp_box(spec, root=root, client=host)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
