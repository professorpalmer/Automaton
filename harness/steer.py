from __future__ import annotations

"""Screenshot steer after report-back. Deterministic patches first; Flash later."""

import re
from pathlib import Path
from typing import Optional, Tuple

import json

from harness.factory import COLOR_WORDS, product_dir, product_index
from harness.gates import FLOOR_MODEL
from harness.jobs import Job, JobError
from harness.vault import load_tenant_openrouter_key, refuse_secret_payload
from harness.workhorse import WorkhorseError, rewrite_html


class SteerError(RuntimeError):
    pass


def apply_instruction(html: str, instruction: str) -> Tuple[str, str]:
    refuse_secret_payload(instruction)
    refuse_secret_payload(html)
    original = html
    notes = []
    for word, hex_color in COLOR_WORDS.items():
        if re.search(rf"\b{word}\b", instruction, flags=re.I):
            html = re.sub(
                r"--accent:\s*#[0-9a-fA-F]{3,8}",
                f"--accent: {hex_color}",
                html,
                count=1,
            )
            notes.append(f"accent={hex_color}")
            break
    renamed = re.search(
        r"(?:rename|call|label)\s+(?:the\s+)?(?:button|cta)?\s*(?:to\s+)?[\"']([^\"']+)[\"']",
        instruction,
        flags=re.I,
    )
    if not renamed:
        renamed = re.search(
            r"button\s+(?:should\s+)?(?:say|read)\s+[\"']([^\"']+)[\"']",
            instruction,
            flags=re.I,
        )
    if renamed:
        label = renamed.group(1).strip()
        html = re.sub(
            r'(<button class="primary" type="submit">)([^<]+)(</button>)',
            rf"\1{label}\3",
            html,
            count=1,
        )
        notes.append(f"action={label}")
    if not notes:
        raise SteerError(
            "I can change button color or label from a screenshot note. "
            "Say something like 'turn that button green' or 'rename the button to Export'."
        )
    if html == original:
        notes.append("already applied")
    return html, "; ".join(notes)


def apply_steer(
    job: Job,
    instruction: str,
    root: Optional[Path] = None,
    sidecar_text: Optional[str] = None,
    opener=None,
) -> str:
    if not job.product_relpath and not product_index(job, root).is_file():
        raise JobError("no product to steer yet")
    dest = product_index(job, root)
    if not dest.is_file():
        raise JobError(f"product missing at {dest}")
    html = dest.read_text(encoding="utf-8")
    try:
        updated, note = apply_instruction(html, instruction)
    except SteerError:
        if not load_tenant_openrouter_key(root):
            raise
        try:
            updated = rewrite_html(
                html,
                instruction,
                sidecar_text=sidecar_text,
                root=root,
                opener=opener,
            )
        except WorkhorseError as exc:
            raise SteerError(str(exc)) from exc
        note = f"workhorse={FLOOR_MODEL}"
    from harness.rewind import snapshot

    snapshot(job, root, instruction)
    dest.write_text(updated, encoding="utf-8")
    spec_path = product_dir(job, root) / "spec.json"
    if spec_path.is_file():
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        found = re.search(r"--accent:\s*(#[0-9a-fA-F]{3,8})", updated)
        if found:
            spec["accent"] = found.group(1)
        action = re.search(r"action=([^;]+)", note)
        if action:
            spec["primary_action"] = action.group(1)
        spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    return note
