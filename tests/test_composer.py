from __future__ import annotations

from harness.composer import (
    enable_on_content_editable,
    insert_mention,
    serialize,
    suggest,
)


def test_send_is_at_label_not_a_span() -> None:
    nodes = insert_mention([{"text": "Ask "}], {"id": "wiki", "label": "Wiki"})
    assert serialize(nodes) == "Ask @Wiki "
    assert "<span" not in serialize(nodes)


def test_suggestion_filters_eight() -> None:
    agents = [{"id": str(i), "label": f"Agent{i}"} for i in range(12)]
    assert len(suggest("agent", agents)) == 8
    assert suggest("wiki", [{"id": "w", "label": "Wiki"}])[0]["id"] == "w"


def test_palette_yields_send_does_not() -> None:
    assert enable_on_content_editable("mod+k") is False
    assert enable_on_content_editable("mod+z") is False
    assert enable_on_content_editable("mod+enter") is True
