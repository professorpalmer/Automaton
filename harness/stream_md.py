from __future__ import annotations

"""Incomplete-fence buffer. Highlighters never see a tag the next token can extend."""

import re
from dataclasses import dataclass, replace
from typing import Optional

_HOLD_OPENER = re.compile(r"(`{1,3}|~{3,})(\w*)\Z")
_OPEN_FENCE = re.compile(r"(^|\n)(```|~~~)(\w*)\n")


@dataclass(frozen=True)
class Fence:
    ticks: str
    lang: str
    body: str


@dataclass(frozen=True)
class Buf:
    flushed: str
    hold: str
    open: Optional[Fence] = None


def empty_buf() -> Buf:
    return Buf(flushed="", hold="", open=None)


def highlighter_input(buf: Buf) -> str:
    """Pretty path. Must not include hold or an extendable language tag."""
    return buf.flushed


def push(buf: Buf, token: str) -> Buf:
    raw = buf.hold + token
    if buf.open is not None:
        return _push_inside(buf, raw)
    opened = _OPEN_FENCE.search(raw)
    if opened:
        head = raw[: opened.start() + len(opened.group(1))]
        rest = raw[opened.start() + len(opened.group(0)) :]
        return push(
            Buf(
                flushed=buf.flushed + head,
                hold=rest,
                open=Fence(ticks=opened.group(2), lang=opened.group(3), body=""),
            ),
            "",
        )
    held = _HOLD_OPENER.search(raw)
    if held:
        return Buf(flushed=buf.flushed + raw[: held.start()], hold=held.group(0), open=None)
    return Buf(flushed=buf.flushed + raw, hold="", open=None)


def _push_inside(buf: Buf, raw: str) -> Buf:
    fence = buf.open
    assert fence is not None
    close = _close_at_eol(raw, fence.ticks)
    if close == -1:
        newline = raw.rfind("\n")
        if newline == -1:
            return replace(buf, hold=raw)
        return Buf(
            flushed=buf.flushed,
            hold=raw[newline + 1 :],
            open=replace(fence, body=fence.body + raw[: newline + 1]),
        )
    after = raw[close + len(fence.ticks) :]
    body = fence.body + raw[:close]
    block = "\n{ticks}{lang}\n{body}{ticks}\n".format(
        ticks=fence.ticks,
        lang=fence.lang,
        body=body,
    )
    hold = after[1:] if after.startswith("\n") else after
    return Buf(flushed=buf.flushed + block, hold=hold, open=None)


def _close_at_eol(raw: str, ticks: str) -> int:
    start = 0
    while True:
        close = raw.find(ticks, start)
        if close == -1:
            return -1
        after = raw[close + len(ticks) :]
        if after == "" or after.startswith("\n"):
            return close
        start = close + 1
