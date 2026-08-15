from __future__ import annotations

"""Mention is an inline atom. Send serializes it. Global hotkeys yield."""

from typing import Dict, List, Sequence, TypedDict


class Mention(TypedDict):
    id: str
    label: str


class TextSpan(TypedDict):
    text: str


Node = Mention | TextSpan


def render_text(node: Node) -> str:
    if "label" in node:
        return "@" + node["label"]
    return node.get("text", "")


def serialize(nodes: Sequence[Node]) -> str:
    return "".join(render_text(node) for node in nodes)


def suggest(query: str, agents: Sequence[Mention], limit: int = 8) -> List[Mention]:
    needle = query.lower()
    return [a for a in agents if needle in a["label"].lower()][:limit]


def insert_mention(nodes: Sequence[Node], mention: Mention) -> List[Node]:
    return list(nodes) + [mention, {"text": " "}]


def enable_on_content_editable(hotkey: str) -> bool:
    """False is the yield. Send is the exception that opts back in."""
    return hotkey in ("mod+enter",)
