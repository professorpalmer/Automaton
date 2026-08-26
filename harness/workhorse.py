from __future__ import annotations

"""Cheap floor workhorse. Flash rewrites HTML when a deterministic steer cannot."""

import json
import urllib.error
import urllib.request
from typing import Optional

from harness.gates import FLOOR_MODEL, TENANT_DISPLAY
from harness.vault import load_tenant_openrouter_key, refuse_secret_payload

REWRITE_PROMPT = (
    "You edit a single Soldiers' Angels operator HTML page. "
    "Return ONLY the full HTML document. Keep the Soldiers' Angels brand. "
    "Apply the operator instruction. Do not add commentary."
)


class WorkhorseError(RuntimeError):
    pass


def rewrite_html(
    html: str,
    instruction: str,
    *,
    sidecar_text: Optional[str] = None,
    root=None,
    opener=None,
    model: str = FLOOR_MODEL,
) -> str:
    refuse_secret_payload(instruction)
    key = load_tenant_openrouter_key(root)
    if not key:
        raise WorkhorseError("tenant OpenRouter key missing")
    user = instruction.strip()
    if sidecar_text:
        user = f"{user}\n\nFrom the screenshot: {sidecar_text.strip()}"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": REWRITE_PROMPT},
            {
                "role": "user",
                "content": f"Instruction:\n{user}\n\nCurrent HTML:\n{html}",
            },
        ],
        "max_tokens": 4000,
        "temperature": 0,
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
    try:
        if opener is not None:
            raw = opener(request)
        else:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
        payload = json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise WorkhorseError(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from exc
    except Exception as exc:
        raise WorkhorseError(repr(exc)) from exc
    try:
        text = payload["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise WorkhorseError("bad workhorse response") from exc
    cleaned = _extract_html(text)
    if "Soldiers" not in cleaned or "Angels" not in cleaned:
        raise WorkhorseError(f"workhorse dropped the {TENANT_DISPLAY} brand")
    if "<button" not in cleaned:
        raise WorkhorseError("workhorse dropped the primary action")
    return cleaned


def _extract_html(text: str) -> str:
    blob = text.strip()
    if blob.startswith("```"):
        blob = blob.split("\n", 1)[-1]
        if blob.endswith("```"):
            blob = blob[: -3].rstrip()
    start = blob.find("<!DOCTYPE")
    if start == -1:
        start = blob.find("<html")
    if start == -1:
        raise WorkhorseError("workhorse did not return HTML")
    return blob[start:].strip()
