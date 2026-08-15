from __future__ import annotations

import pytest

from harness.reply_first import (
    ReplyFirstError,
    ack_for,
    legal_first,
    reduce,
    split_delivery,
)


def test_ack_must_be_a_finished_sentence() -> None:
    assert legal_first("I've got someone working on that.", "ack")
    assert not legal_first("Working...", "ack")
    assert not legal_first("Great question", "ack")
    assert not legal_first("I've got someone working on that", "ack")


def test_user_wake_requires_text_before_tools() -> None:
    state = reduce("idle", "wake_user")
    assert state == "must_first"
    with pytest.raises(ReplyFirstError, match="first text"):
        reduce(state, "tool")
    state = reduce(state, "first_ack")
    assert reduce(state, "tool") == "working"


def test_ack_is_not_rewritten_into_delivery() -> None:
    state = reduce("idle", "wake_user")
    state = reduce(state, "first_ack")
    state = reduce(state, "deliver")
    assert state == "must_deliver"
    assert reduce(state, "end") == "closed"


def test_cannot_close_on_ack_alone() -> None:
    state = reduce(reduce("idle", "wake_user"), "first_ack")
    with pytest.raises(ReplyFirstError, match="delivery"):
        reduce(state, "end")


def test_background_may_stay_silent() -> None:
    assert reduce("idle", "wake_background") == "working"


def test_owned_acks_and_split() -> None:
    assert legal_first(ack_for("build"), "ack")
    assert legal_first(ack_for("steer"), "ack")
    assert legal_first(ack_for("intake"), "ack")
    assert ack_for("intake") == "I've got someone working on that."
    bubbles = split_delivery(
        "The tool is ready. Open it, then tell me what to change — a screenshot is enough."
    )
    assert len(bubbles) == 2
