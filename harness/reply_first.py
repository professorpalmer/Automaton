from __future__ import annotations

"""Reply-first turn algebra. The ack is committed. Work appends. Never rewrite."""

import re
from typing import Literal

State = Literal[
    "idle",
    "must_first",
    "answered",
    "working",
    "must_deliver",
    "closed",
]

EventType = Literal[
    "wake_user",
    "wake_background",
    "first_answer",
    "first_ack",
    "first_tapback",
    "tool",
    "beat",
    "mechanic",
    "deliver",
    "ask",
    "end",
]

_SKELETON = re.compile(
    r"^(certainly|of course|great question|tldr|quick version|done[—-])\b"
    r"|^\.+$|^working\.{0,3}$|^let me think",
    re.I,
)
_FINISHED = re.compile(r"[.!?]$")


class ReplyFirstError(RuntimeError):
    pass


def legal_first(text: str, mode: Literal["answer", "ack"]) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return False
    if _SKELETON.search(cleaned):
        return False
    if mode == "ack":
        return len(cleaned) < 160 and bool(_FINISHED.search(cleaned))
    return True


def reduce(state: State, event: EventType) -> State:
    if event == "wake_user":
        return "must_first"
    if event == "wake_background":
        return "working"
    if event == "first_tapback":
        if state != "must_first":
            return state
        return "closed"
    if event == "first_answer":
        if state != "must_first":
            return state
        return "answered"
    if event == "first_ack":
        if state != "must_first":
            return state
        return "working"
    if event == "tool":
        if state == "must_first":
            raise ReplyFirstError("no tools before first text")
        return "answered" if state == "answered" else "working"
    if event == "mechanic":
        return state
    if event in ("beat", "deliver"):
        if state == "must_first":
            raise ReplyFirstError("no work output before first text")
        return "must_deliver" if event == "deliver" else "working"
    if event == "ask":
        return "closed"
    if event == "end":
        if state == "must_first":
            raise ReplyFirstError("silence on a user wake")
        if state == "working":
            raise ReplyFirstError("ack is not delivery")
        return "closed"
    return state


def ack_for(intent: Literal["build", "steer", "intake"]) -> str:
    if intent == "steer":
        return "Changing the tool from that note."
    if intent == "intake":
        return "I've got someone working on that."
    return "I've got a team working on your request."


def split_delivery(report: str) -> list[str]:
    """Ack stays. Delivery may be one or two thoughts. Never a mechanic echo."""
    from harness.bubbles import bubbles_for_report

    return bubbles_for_report(report)
