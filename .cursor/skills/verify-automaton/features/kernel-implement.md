# Kernel implement-in-sandbox

Kernel job language (fix/implement/patch/…) dispatches a Puppetmaster implement worker. The worker cwd is a git worktree under `~/.automaton/sandboxes/<localId>`, never the live Automaton checkout.

## Sub-features

- `JobHandle.kind` is `implement` for Kernel job language
- Config is `run --config` with `mode: implement`, `implement: true`, `allow_dirty: true`, `allow_non_worktree: false`
- `git worktree add -b automaton-sandbox-<id>` from the product repo; copy+`git init` is not the path
- `assertSandboxCwd` throws if cwd is the Automaton checkout
- Spoken lines still strip job ids

## How to get to it (user POV)

Click Kernel. Send a long fix request. The strip shows `Kernel · implement · …`. Send stays Send. The live checkout is not the worker cwd.

## Driving it

- Kind routing: `tests/domain.test.ts`, `tests/session.test.ts`
- Config/sandbox: `tests/pm.test.ts` (`writeImplementConfig`, worktree seed)
- Analyze live attach remains `bun scripts/probe-kernel.ts` (read-only). Nested Cursor-agent CLI implement hits SDK `status:error`; the native Automaton window is the spawn host.
- A native flying implement handle is still required for a complete Michael walkthrough; the current live PM probe is recorded as failed rather than simulated.

## Gotchas

Do not pass `--implement` against Automaton. Do not `allow_non_worktree` to dodge the worktree. Stop kills the `run` process Automaton spawned.
