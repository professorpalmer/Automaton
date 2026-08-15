from __future__ import annotations

"""Ask until ready. Build. Then ask for whatever the live tool still lacks."""

import re
from typing import Any, List, Optional, Sequence, Union

from harness.attachments import have_kinds, kind_of

YES = "I've got someone working on that."
NEED_THINGS = "We will need some things from you before we can finish, though."
TEAM = "I've got a team working on your request."
SEALED = "This is the one. I will keep the project here."
GO = re.compile(
    r"\b(go ahead|that'?s all|that is all|build it|just build|start anyway|"
    r"i don'?t have|i do not have|no file|no workbook|skip)\b",
    re.I,
)
ENOUGH = re.compile(
    r"\b(that'?s all|that is all|i don'?t have|i do not have|no file|no workbook|skip)\b",
    re.I,
)
WORKBOOK = re.compile(
    r"\b(reconcil|workbook|\.xlsx|spreadsheet|excel|ledger|lyft|flix)\b",
    re.I,
)
SAMPLE = re.compile(r"\b(letter|donation|pdf pack|sample (export|output|report))\b", re.I)
LIVE = re.compile(r"\b(formassembly|sharepoint|salesforce|tfaforms)\b", re.I)
NAMED_FILE = re.compile(r"\b([A-Za-z0-9._-]+\.(?:csv|xlsx|xlsm|xls|pdf|docx))\b")

Have = Union[set, Sequence[str], Any]


def feature_for(brief: str, name: str = "") -> str:
    text = (brief or "").lower()
    if "exception" in text:
        return "exception export"
    if "letter" in text or "donation" in text:
        return "letter pack"
    if "lyft" in text:
        return "Lyft match"
    if "formassembly" in text or re.search(r"\bfa\b", text):
        return "FormAssembly match"
    if "waitlist" in text:
        return "waitlist"
    if name:
        return f"{name} import"
    return "that part"


def needs_for(brief: str) -> List[dict]:
    from harness.factory import wants_service
    from harness.known import is_known_link_update

    text = brief or ""
    if is_known_link_update(text):
        return []
    needs: List[dict] = []
    named = []
    seen = set()
    for raw in NAMED_FILE.findall(text):
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        named.append(
            {
                "id": "file:" + key,
                "kind": kind_of(raw),
                "label": raw,
                "example": raw,
                "feature": feature_for(text, raw),
                "required": kind_of(raw) == "workbook",
            }
        )
    named_workbook = any(item["kind"] == "workbook" for item in named)
    if (wants_service(text) or WORKBOOK.search(text)) and not named_workbook:
        needs.append(
            {
                "id": "workbook",
                "kind": "workbook",
                "label": "this month's workbook",
                "example": "month.csv",
                "feature": feature_for(text) or "reconciliation",
                "required": True,
            }
        )
    needs.extend(named)
    if SAMPLE.search(text) and not any(item["id"] == "sample" for item in needs):
        needs.append(
            {
                "id": "sample",
                "kind": "document",
                "label": "a sample of the export or letter you want back",
                "example": "sample.pdf",
                "feature": feature_for(text) or "letter pack",
                "required": False,
            }
        )
    if not needs:
        needs.append(
            {
                "id": "screenshot",
                "kind": "image",
                "label": "a screenshot of the current page",
                "example": "page.png",
                "feature": feature_for(text) or "layout",
                "required": True,
            }
        )
    return needs


def merge_needs(existing: Sequence[dict], incoming: Sequence[dict]) -> List[dict]:
    merged = []
    seen = set()
    for item in list(existing or []) + list(incoming or []):
        key = item.get("id") or item.get("label")
        if key in seen:
            continue
        seen.add(key)
        merged.append(dict(item))
    return merged


def have_need(need: dict, have: Have) -> bool:
    example = (need.get("example") or "").lower()
    named = str(need.get("id") or "").startswith("file:")
    kind = need.get("kind")
    if hasattr(have, "files"):
        for record in have.files:
            name = (getattr(record, "name", "") or "").lower()
            if example and name == example:
                return True
            if not named and getattr(record, "kind", "") == kind:
                return True
        if kind == "image" and getattr(have, "images", None):
            return True
        return False
    kinds = set(have or [])
    return kind in kinds


def next_missing(needs: Sequence[dict], have: Have) -> Optional[dict]:
    for need in needs:
        if not have_need(need, have):
            return need
    return None


def missing_required(needs: Sequence[dict], have: Have) -> List[dict]:
    return [
        need
        for need in needs
        if need.get("required") and not have_need(need, have)
    ]


def still_needed(needs: Sequence[dict], have: Have) -> List[dict]:
    return [need for need in needs if not have_need(need, have)]


def required_still(needs: Sequence[dict], have: Have) -> List[dict]:
    return [need for need in still_needed(needs, have) if need.get("required")]


def keep_met(needs: Sequence[dict], have: Have) -> List[dict]:
    return [need for need in needs if have_need(need, have)]


DONE = re.compile(
    r"\b(this is it|it'?s (perfect|done)|perfect,? it'?s done|this is the one|ship it)\b",
    re.I,
)


def operator_said_go(note: str) -> bool:
    return bool(GO.search(note or ""))


def operator_said_done(note: str) -> bool:
    return bool(DONE.search(note or ""))


def operator_said_enough(note: str) -> bool:
    return bool(ENOUGH.search(note or ""))


def ready_to_build(needs: Sequence[dict], have: Have, note: str = "") -> bool:
    if operator_said_go(note):
        return True
    required = [need for need in needs if need.get("required")]
    if required:
        return not missing_required(needs, have)
    return next_missing(needs, have) is None


def still_ask(need: dict) -> str:
    name = need.get("label") or need.get("example")
    feature = need.get("feature") or need.get("label")
    return (
        f"One thing I still need, {name}, in order to make the {feature} work. "
        "Can you drop that?"
    )


def ask_text(brief: str, needs: Sequence[dict], have: Have) -> str:
    nxt = next_missing(needs, have)
    if nxt is None:
        return "That is enough. I will start."
    name = nxt.get("label") or nxt.get("example")
    line = f"I need {name}. Drag it here."
    if LIVE.search(brief or ""):
        line += " If this lives in FormAssembly or SharePoint, send the file — I cannot log in."
    return line


def intake_bubbles(
    brief: str,
    needs: Sequence[dict],
    have: Have,
    *,
    first: bool = False,
) -> List[str]:
    ask = ask_text(brief, needs, have)
    if first:
        return [YES, ask]
    return [TEAM, ask]


def closing_bubbles(
    job: Any,
    spec: Any = None,
    live_path: str = "",
    *,
    reused: bool = False,
) -> List[str]:
    url = getattr(job, "live_url", "") or live_path or f"/product/{getattr(job, 'id', '')}/"
    shipped = (
        f"The team is finished with your project! It is available here at {url}. "
        "Check it out and let me know what you think. Please share any comments, "
        "adjustments, concerns, or feature requests and we will continue to polish "
        "it exactly how you like."
    )
    if reused:
        lines = [
            shipped,
            "I already built this. This run billed $0.",
        ]
    else:
        lines = [shipped]
    if not getattr(job, "live_url", ""):
        lines.append("I can put it on Render when you drop a Render API key.")
    kind = getattr(spec, "kind", None)
    files = getattr(job, "files", None) or []
    needed = getattr(job, "needed", None)
    if needed is None:
        needed = needs_for(getattr(job, "brief", "") or "")
    service = kind == "service" or any(item.get("kind") == "workbook" for item in needed)
    if service:
        if any(getattr(record, "kind", "") == "workbook" for record in files):
            lines.append("I kept the workbook you dropped.")
        lines.append("I did not connect to FormAssembly, Lyft, or SharePoint.")
    leftover = still_needed(needed, job)
    if leftover:
        lines.append(still_ask(leftover[0]))
    else:
        lines.append("Open it, then tell me what to change. A screenshot is enough.")
    return lines
