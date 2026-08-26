from __future__ import annotations

"""One job, one subprocess. The face does not wait on this process."""

import argparse
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Automaton build crew")
    parser.add_argument("--job", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--followup", action="store_true")
    args = parser.parse_args(argv)
    from harness.loop import apply_followup, finish_build

    if args.followup:
        apply_followup(args.job, root=Path(args.root))
    else:
        finish_build(args.job, root=Path(args.root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
