from __future__ import annotations

from harness.stream_md import Buf, empty_buf, highlighter_input, push


def test_python_fence_split_across_tokens_stays_in_hold() -> None:
    buf = push(empty_buf(), "```py")
    assert buf.hold == "```py"
    assert buf.open is None
    assert highlighter_input(buf) == ""
    buf = push(buf, "thon\n")
    assert buf.open is not None
    assert buf.open.lang == "python"
    assert buf.open.body == ""
    assert "thon" not in highlighter_input(buf)
    assert "```py" not in highlighter_input(buf)


def test_two_ticks_then_third_do_not_flash_inline_code() -> None:
    buf = push(empty_buf(), "``")
    assert highlighter_input(buf) == ""
    assert buf.hold == "``"
    buf = push(buf, "`python\nprint(1)\n```\n")
    assert buf.open is None
    pretty = highlighter_input(buf)
    assert pretty.startswith("\n```python\n")
    assert "print(1)" in pretty
    assert pretty.count("```") == 2


def test_close_ticks_inside_code_are_not_a_fence() -> None:
    buf = push(empty_buf(), "```js\nconst ticks = '```notclose'\n")
    assert buf.open is not None
    assert "notclose" in (buf.open.body + buf.hold)
    buf = push(buf, "```\n")
    assert buf.open is None
    assert "const ticks" in highlighter_input(buf)


def test_plain_prose_flushes() -> None:
    buf = push(empty_buf(), "A message is a tagged part, not a string.")
    assert buf == Buf(
        flushed="A message is a tagged part, not a string.",
        hold="",
        open=None,
    )
