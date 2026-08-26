from __future__ import annotations

"""Multi-bubble writing. One thought per bubble. A memo only when they asked."""

import re
from typing import List

from harness.reply_first import legal_first

_THROAT = re.compile(
    r"^(great question!?|of course!?|certainly!?|sure!?|so basically|"
    r"here'?s a quick version:?|tldr:?|quick version:?|done[—-])\s*",
    re.I,
)
_MECHANIC = re.compile(
    r"^(on it!?|opening\b|found\b|still working|still running|"
    r"working\.{0,3}|let me think)\b",
    re.I,
)
_MEMO_ASK = re.compile(
    r"\b(list|steps|options|summary|checklist|bullets?|flat list|"
    r"each as a bullet|ship list)\b",
    re.I,
)
_ENUM_LINE = re.compile(r"^(\d+[.)]\s+|[-*]\s+)")
_HEADER = re.compile(r"^#{1,6}\s+|\*\*[^*]+\*\*\s*$", re.M)
_ACTOR_RESULT = re.compile(
    r"\bI (found|looked|checked|saw|died)\b|"
    r"\b(the job died|the (test|job|build) failed|the tool is ready)\b",
    re.I,
)
_ACTOR_NEXT = re.compile(
    r"\bI am\b|^(open it|next|then tell)\b",
    re.I,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def is_memo_ask(ask: str) -> bool:
    return bool(_MEMO_ASK.search(ask or ""))


def is_mechanic(text: str) -> bool:
    return bool(_MECHANIC.search((text or "").strip()))


def is_enumerable(text: str) -> bool:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    if len(lines) < 3:
        return False
    if sum(1 for line in lines if _ENUM_LINE.match(line)) >= 3:
        return True
    return all(len(line) < 120 for line in lines)


def is_accidental_memo(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return False
    if _HEADER.search(cleaned):
        return True
    paragraphs = [part for part in re.split(r"\n\s*\n", cleaned) if part.strip()]
    if len(paragraphs) > 2:
        return True
    return "next steps:" in cleaned.lower() and sentence_count(cleaned) >= 3


def sentence_count(text: str) -> int:
    parts = [part.strip() for part in _SENTENCE.split((text or "").strip()) if part.strip()]
    return max(len(parts), 1) if (text or "").strip() else 0


def strip_lead(text: str) -> str:
    cleaned = (text or "").strip()
    while True:
        next_text = _THROAT.sub("", cleaned, count=1).strip()
        if next_text == cleaned:
            return cleaned
        cleaned = next_text


def bubbles_for_report(report: str, *, ask: str = "") -> List[str]:
    """Public chat parts after an ack. Empty if the report is only a mechanic."""
    return split_into_bubbles(report, ask=ask)


def split_into_bubbles(text: str, *, ask: str = "") -> List[str]:
    cleaned = strip_lead(text)
    if not cleaned:
        return []
    if is_mechanic(cleaned) and sentence_count(cleaned) <= 1:
        return []
    if is_memo_ask(ask) or is_enumerable(cleaned):
        return [cleaned]
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    kept = [line for line in lines if not is_mechanic(line)]
    if not kept:
        return []
    sentences: List[str] = []
    for line in kept:
        sentences.extend(part.strip() for part in _SENTENCE.split(line) if part.strip())
    packed: List[str] = []
    current: List[str] = []
    for sentence in sentences:
        if current and _should_break(current[-1], sentence):
            packed.append(" ".join(current))
            current = [sentence]
            continue
        current.append(sentence)
    if current:
        packed.append(" ".join(current))
    return [bubble for bubble in packed if bubble]


def _should_break(previous: str, nxt: str) -> bool:
    if _ACTOR_RESULT.search(previous) and _ACTOR_NEXT.search(nxt):
        return True
    return False


def legal_ack(text: str) -> bool:
    return legal_first(text, "ack")
