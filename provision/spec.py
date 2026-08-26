from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Mapping

from harness.gates import TENANT_DISPLAY, TENANT_SLUG

DEFAULT_REPO = "https://github.com/professorpalmer/Automaton"
DEFAULT_BRANCH = "main"
DEFAULT_PLAN = "starter"
DEFAULT_REGION = "oregon"
BOX_SERVICE_SUFFIX = "-automaton"

_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_BLOCKED_ENV = frozenset(
    {
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "CURSOR_API_KEY",
    }
)


class StampError(ValueError):
    pass


@dataclass
class BoxSpec:
    slug: str
    display: str
    render_api_key: str
    openrouter_api_key: str = ""
    github_token: str = ""
    repo: str = DEFAULT_REPO
    branch: str = DEFAULT_BRANCH
    image: str = ""
    plan: str = DEFAULT_PLAN
    region: str = DEFAULT_REGION
    extras: dict[str, str] = field(default_factory=dict)

    @property
    def service_name(self) -> str:
        return self.slug + BOX_SERVICE_SUFFIX


@dataclass
class BoxRecord:
    slug: str
    display: str
    service_id: str = ""
    url: str = ""
    repo: str = DEFAULT_REPO
    branch: str = DEFAULT_BRANCH
    image: str = ""
    status: str = "pending"
    need: str = ""
    ask: str = ""
    updated_at: str = ""

    def public(self) -> dict:
        return {
            "slug": self.slug,
            "display": self.display,
            "service_id": self.service_id,
            "url": self.url,
            "repo": self.repo,
            "branch": self.branch,
            "image": self.image,
            "status": self.status,
            "need": self.need,
            "ask": self.ask,
            "updated_at": self.updated_at,
        }


def service_name_for(slug: str) -> str:
    return (slug or "").strip() + BOX_SERVICE_SUFFIX


def spec_from_payload(payload: Mapping[str, object]) -> BoxSpec:
    extras_raw = payload.get("extras") or {}
    extras = {}
    if isinstance(extras_raw, Mapping):
        extras = {str(key): str(value) for key, value in extras_raw.items() if str(value).strip()}
    return normalize_spec(
        BoxSpec(
            slug=str(payload.get("slug") or TENANT_SLUG),
            display=str(payload.get("display") or TENANT_DISPLAY),
            render_api_key=str(payload.get("render_api_key") or ""),
            openrouter_api_key=str(payload.get("openrouter_api_key") or ""),
            github_token=str(payload.get("github_token") or ""),
            repo=str(payload.get("repo") or DEFAULT_REPO),
            branch=str(payload.get("branch") or DEFAULT_BRANCH),
            image=str(payload.get("image") or ""),
            plan=str(payload.get("plan") or DEFAULT_PLAN),
            region=str(payload.get("region") or DEFAULT_REGION),
            extras=extras,
        )
    )


def normalize_spec(spec: BoxSpec) -> BoxSpec:
    spec.slug = (spec.slug or "").strip().lower()
    spec.display = (spec.display or "").strip()
    spec.render_api_key = (spec.render_api_key or "").strip()
    spec.openrouter_api_key = (spec.openrouter_api_key or "").strip()
    spec.github_token = (spec.github_token or "").strip()
    spec.repo = (spec.repo or DEFAULT_REPO).strip()
    spec.branch = (spec.branch or DEFAULT_BRANCH).strip()
    spec.image = (spec.image or "").strip()
    spec.plan = (spec.plan or DEFAULT_PLAN).strip()
    spec.region = (spec.region or DEFAULT_REGION).strip()
    if not spec.slug or not _SLUG.match(spec.slug):
        raise StampError("org slug must be lowercase letters, numbers, and hyphens")
    if not spec.display:
        raise StampError("org display name is required")
    if not spec.render_api_key:
        raise StampError("their Render API key is required so the box lives on their account")
    if spec.repo and not spec.repo.startswith("https://"):
        raise StampError("repo must be an https URL")
    if spec.image and not spec.image.startswith(("https://", "docker.io/", "ghcr.io/", "http://")):
        if "/" not in spec.image:
            raise StampError("image must be a registry reference")
    blocked = [name for name in spec.extras if name.strip().upper() in _BLOCKED_ENV]
    if blocked:
        raise StampError("refusing to put a host key on a client box")
    return spec
