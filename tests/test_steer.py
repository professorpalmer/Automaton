from __future__ import annotations

import pytest

from harness.steer import SteerError, apply_instruction


SAMPLE = """
:root { --accent: #1f5c45; }
<button class="primary" type="submit">Submit</button>
"""


def test_turn_button_green() -> None:
    html, note = apply_instruction(SAMPLE, "turn that button green")
    assert "--accent: #1f5c45" in html
    assert "accent=" in note


def test_turn_button_blue() -> None:
    html, _note = apply_instruction(SAMPLE, "turn that button blue")
    assert "--accent: #4472c4" in html


def test_rename_button() -> None:
    html, note = apply_instruction(SAMPLE, "rename the button to 'Export'")
    assert ">Export</button>" in html
    assert "action=Export" in note


def test_unknown_steer_explains_the_floor() -> None:
    with pytest.raises(SteerError, match="green"):
        apply_instruction(SAMPLE, "make it feel more playful")
