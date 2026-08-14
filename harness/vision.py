from __future__ import annotations

"""Always-on vision. Accept every image. Sidecar when the floor is text-only."""

import base64
import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Protocol

from harness.gates import (
    FLOOR_MODEL,
    VISION_SIDECAR_MODEL,
    workhorse_is_text_only,
)
from harness.jobs import ImageRecord
from harness.paths import uploads_dir
from harness.vault import load_tenant_openrouter_key

SIDECAR_PROMPT = (
    "Transcribe and describe this image for a text-only operator-tool builder. "
    "If it is a screenshot or UI, capture visible text verbatim and describe "
    "layout, colors, and controls. Do not speculate beyond what is visible."
)


class VisionUnusable(RuntimeError):
    """Images were attached but neither native pixels nor sidecar text is usable."""


class Sidecar(Protocol):
    name: str

    def transcribe(self, image_path: str) -> "VisionResult":
        ...


@dataclass
class VisionResult:
    text: str
    model: str = ""
    error: Optional[str] = None
    tokens_out: int = 0
    cost_usd: Optional[float] = None
    latency_ms: float = 0.0


@dataclass
class PreparedVision:
    attachments: List[ImageRecord]
    delivery: str
    sidecar_text: Optional[str]
    results: List[VisionResult]

    def assert_usable(self) -> None:
        if not self.attachments:
            return
        if self.delivery == "native_pixels":
            return
        if self.sidecar_text and self.sidecar_text.strip():
            return
        errors = [result.error or "empty transcription" for result in self.results]
        raise VisionUnusable(
            "images were accepted but transcription failed: " + "; ".join(errors)
        )


def media_type(name: str, fallback: str = "image/png") -> str:
    lower = (name or "").lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    if fallback.startswith("image/"):
        return fallback
    return "image/png"


def accept_image(
    payload: bytes,
    *,
    filename: str,
    mime: str = "",
    job_id: str,
    root: Optional[Path] = None,
) -> ImageRecord:
    """Persist the image. Never refuse. Never drop."""
    if not payload:
        raise ValueError("empty image payload")
    dest_dir = uploads_dir(root) / job_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    image_id = str(uuid.uuid4())
    suffix = Path(filename or "paste.png").suffix or ".png"
    dest = dest_dir / f"{image_id}{suffix}"
    dest.write_bytes(payload)
    return ImageRecord(
        id=image_id,
        path=str(dest),
        mime=media_type(filename, mime or "image/png"),
        bytes=len(payload),
        accepted_at=datetime.now(timezone.utc).isoformat(),
        dropped=False,
    )


def prepare_for_workhorse(
    attachments: List[ImageRecord],
    *,
    workhorse_model: str = FLOOR_MODEL,
    sidecar: Optional[Sidecar] = None,
) -> PreparedVision:
    if not attachments:
        return PreparedVision([], "none", None, [])
    if any(record.dropped for record in attachments):
        raise VisionUnusable("an image was marked dropped; that is forbidden")
    if not workhorse_is_text_only(workhorse_model):
        return PreparedVision(attachments, "native_pixels", None, [])
    if sidecar is None:
        sidecar = TenantOpenRouterSidecar()
    results: List[VisionResult] = []
    texts: List[str] = []
    for record in attachments:
        result = sidecar.transcribe(record.path)
        results.append(result)
        if result.text and result.text.strip() and not result.error:
            texts.append(result.text.strip())
    sidecar_text = "\n\n".join(texts) if texts else None
    prepared = PreparedVision(attachments, "sidecar_text", sidecar_text, results)
    prepared.assert_usable()
    return prepared


class TenantOpenRouterSidecar:
    """VLM transcription billed to the tenant key only."""

    def __init__(
        self,
        *,
        model: str = VISION_SIDECAR_MODEL,
        root: Optional[Path] = None,
        timeout: int = 60,
        opener=None,
    ) -> None:
        self.model = model
        self.root = root
        self.timeout = timeout
        self.opener = opener
        self.name = f"vlm:{model}"

    def transcribe(self, image_path: str) -> VisionResult:
        key = load_tenant_openrouter_key(self.root)
        if not key:
            return VisionResult(
                "",
                model=self.name,
                error="tenant OpenRouter key missing; put it in tenant/secrets/openrouter.key",
            )
        path = Path(image_path)
        raw = path.read_bytes()
        b64 = base64.b64encode(raw).decode("ascii")
        mime = media_type(path.name)
        body = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": SIDECAR_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                }
            ],
            "max_tokens": 800,
        }
        request = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
            },
            method="POST",
        )
        started = time.time()
        try:
            if self.opener is not None:
                raw_response = self.opener(request, timeout=self.timeout)
            else:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw_response = response.read()
            payload = json.loads(raw_response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            return VisionResult(
                "",
                model=self.name,
                error=f"HTTP {exc.code}: {detail}",
                latency_ms=(time.time() - started) * 1000,
            )
        except Exception as exc:
            return VisionResult(
                "",
                model=self.name,
                error=repr(exc),
                latency_ms=(time.time() - started) * 1000,
            )
        try:
            text = payload["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return VisionResult(
                "",
                model=self.name,
                error=f"bad VLM response: {str(payload)[:200]}",
                latency_ms=(time.time() - started) * 1000,
            )
        usage = payload.get("usage") or {}
        cost = None
        if isinstance(payload.get("usage"), dict) and "cost" in usage:
            try:
                cost = float(usage["cost"])
            except (TypeError, ValueError):
                cost = None
        return VisionResult(
            text=text,
            model=self.name,
            tokens_out=int(usage.get("completion_tokens") or 0),
            cost_usd=cost,
            latency_ms=(time.time() - started) * 1000,
        )
