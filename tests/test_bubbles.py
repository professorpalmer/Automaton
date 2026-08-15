from __future__ import annotations

from harness.bubbles import (
    bubbles_for_report,
    is_accidental_memo,
    is_enumerable,
    is_mechanic,
    is_memo_ask,
    split_into_bubbles,
    strip_lead,
)


def test_ci_failure_is_two_beats_not_a_memo() -> None:
    before = (
        "Great question! I looked into the CI failure and here’s a quick version: "
        "the job failed on test_fill_lib.py because of an import, then I reran it, "
        "then I checked ruff. Next steps: 1) fix the import 2) rerun 3) let me know "
        "if you want me to go deeper."
    )
    after = [
        "The job died in test_fill_lib.py on a missing fill_lib import, not ruff.",
        "I am pointing the test at the package path and rerunning that file.",
    ]
    assert strip_lead(before).lower().startswith("i looked")
    assert is_accidental_memo(before)
    assert split_into_bubbles(" ".join(after)) == after


def test_mention_chip_drops_status_play_by_play() -> None:
    before = [
        "On it!",
        "Opening the composer file…",
        "Found TipTap.",
        "Still working on the mention extension…",
        "Done — added mentions.",
    ]
    after = [
        "Adding mentions as an editor node, not a regex on the string.",
        "@ now inserts a mention node with id + label. Send serializes it. Edit keeps it. No extra animation.",
    ]
    assert all(is_mechanic(line) or line.lower().startswith("done") for line in before)
    assert [line for line in before if not is_mechanic(line) and not line.lower().startswith("done")] == []
    assert split_into_bubbles(after[0]) == [after[0]]
    assert split_into_bubbles(after[1]) == [after[1]]


def test_ship_checklist_stays_one_memo() -> None:
    ask = "Give me the ship checklist"
    before = (
        "Sure! So basically we should merge, then deploy, then validate MAPE, "
        "and also maybe make a card? Want me to go deeper?"
    )
    after = (
        "Merge PR #329 to master/dev only.\n"
        "Transfer table ownership to PSE_Data_Engineering.\n"
        "Run a real seasonal retrain.\n"
        "Check MAPE against the 8.6% / 4% anchors.\n"
        "Unpause the job.\n"
        "Trash the duplicate dashboard."
    )
    assert is_memo_ask(ask)
    assert strip_lead(before).lower().startswith("we should merge")
    assert is_enumerable(after)
    assert split_into_bubbles(after, ask=ask) == [after]
    assert len(split_into_bubbles(after, ask=ask)) == 1


def test_ready_report_splits_result_from_next_step() -> None:
    bubbles = bubbles_for_report(
        "The tool is ready. Open it, then tell me what to change — a screenshot is enough."
    )
    assert bubbles == [
        "The tool is ready.",
        "Open it, then tell me what to change — a screenshot is enough.",
    ]


def test_mechanic_report_is_not_a_second_hello() -> None:
    assert bubbles_for_report("Working...") == []
    assert bubbles_for_report("Still working") == []
