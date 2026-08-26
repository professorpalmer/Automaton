from __future__ import annotations

"""Durable build subprocess. The chief stays on the chat; the crew flies."""

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from harness.paths import jobs_dir, repo_root


def spawn_build(job_id: str, root: Optional[Path] = None, followup: bool = False) -> int:
    workspace = Path(root) if root is not None else repo_root()
    log = jobs_dir(workspace) / f"{job_id}.worker.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    handle = open(log, "ab")
    env = os.environ.copy()
    env["AUTOMATON_ROOT"] = str(workspace)
    env["TOYVENDOR_ROOT"] = str(workspace)
    env["PYTHONPATH"] = str(repo_root()) + os.pathsep + env.get("PYTHONPATH", "")
    env["GIT_PAGER"] = "cat"
    env["PAGER"] = "cat"
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["PYTHONUTF8"] = "1"
    args = [
        sys.executable,
        "-m",
        "harness.worker",
        "--job",
        job_id,
        "--root",
        str(workspace),
    ]
    if followup:
        args.append("--followup")
    kwargs = {
        "args": args,
        "cwd": str(repo_root()),
        "stdout": handle,
        "stderr": subprocess.STDOUT,
        "start_new_session": True,
        "env": env,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return subprocess.Popen(**kwargs).pid
