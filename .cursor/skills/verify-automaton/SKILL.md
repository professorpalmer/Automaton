---
name: verify-automaton
description: >-
  Drive the Automaton GPUIX staff app the way a user does. Use when proving
  rail, composer Send, job handles, or fan-out confirm. Not Marionette. Not ToyVendor.
---

# Verify Automaton

Native GPU window. React authored via `@gpuix/react`. Puppetmaster is the job runtime (wave 2). Isolated from ToyVendor and Marionette.

## Launch

```
cd ~/Projects/Automaton
bun install
bun test
bun --hot src/main.tsx
```

Ready: stdout contains `[gpuix] created native window` then `[gpuix] mount complete`.

Teardown: quit the traffic-light close on the Automaton window, or kill only the bun pid you started. Do not kill by process name.

## Doctor

- `bun test` green (domain + session + pm contract + native shell paint).
- `ls node_modules/@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node` on this Mac.
- Window title Automaton. Left rail lists Staff, Kernel, Research.
- Live Kernel analyze: `bun scripts/probe-kernel.ts` attaches a `job_*` id via `run --config`. Nested Cursor-agent shells can see SDK `status:error`; native `bun --hot src/main.tsx` is the spawn host.
- Staff mouth: `bun scripts/probe-mouth.ts` (OpenRouter; key from Automaton or Marionette). Query-first claims are unit-tested with no HTTP.
- Kernel implement contract is unit-tested (`writeImplementConfig` cwd outside checkout, git worktree seed). Do not `--implement` on this checkout.

## Drive

Stable handles (GPUIX `testId`):

- `agent-staff`, `agent-kernel`, `agent-research`
- `composer`, `send`
- `job-strip`, `stop-<jobId>`
- `fanout-confirm`, `fanout-confirm-yes`, `fanout-confirm-no`

Headless: `createTestRoot()` from `@gpuix/react/testing` plus `captureScreenshot`. Live: click the rail, type in the composer, Enter/Send.

## Evidence

- Domain: `bun test` (lock isolation, fan-out confirm, unread on complete, Research analyze vs Kernel implement).
- Native: `artifacts/shots/shell-idle.png` from the shell test.
- Live analyze: `[gpuix] created native window` in the bun log; probe `artifacts/pm-probe.json`.
- Live mouth: `artifacts/mouth-probe.json` (`canned` must be false).

## Cleanup

Leave screenshots. Kill only the bun pid this skill started.

## Helpers

```
bun test
bun --hot src/main.tsx
bun scripts/probe-mouth.ts
```
