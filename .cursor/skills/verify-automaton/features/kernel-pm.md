# Kernel Puppetmaster analyze

Kernel (and Research lookup) speak, then a Puppetmaster analyze job flies. The handle is not chat. Send stays Send. Implement is a different feature: [kernel-implement.md](./kernel-implement.md).

## Sub-features

- Local job row exists immediately; `kind` is `analyze`
- `pmJobId` attaches after `puppetmaster run --config` (MCP twin: pinned grok-4.6 analysis). Do not use `puppetmaster swarm` detach or the `cursor` one-shot; both returned empty SDK `status:error` here.
- Analyze `--cwd` is the Automaton checkout (read-only)
- Completion wakes the owner mouth; unread if Staff is focused
- Spoken lines do not include job ids

## How to get to it (user POV)

Click Kernel. Send a look-up request (not a fix). Or click Research and look something up. Switch to Staff. Keep talking. When the owner finishes, that rail shows unread.

## Driving it

- Session: `tests/session.test.ts` completion + unread
- Argv: `tests/pm.test.ts` analyze config
- Live job id: `bun scripts/probe-kernel.ts` writes `artifacts/pm-probe.json`
- Native walkthrough: a successful run must show a live `analyze` handle in the strip; `artifacts/pm-probe.json` currently records `Didn't land.` for the configured Cursor SDK/model path.

## Gotchas

Do not pass `--implement` against Automaton. Stop kills the `run` process Automaton spawned. After `job_id` prints, keep draining CLI stdout or the orchestrator blocks on a full pipe. Do not turn a `status:error` or `Didn't land.` result into a passing native proof; preserve the artifact and report the runtime blocker.
