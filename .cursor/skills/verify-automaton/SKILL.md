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
- Window title Automaton. Left rail lists Staff, Kernel, Research as baked marks (`src/marks/`), plus New agent above Settings.
- Factory mouths deal a catalog mark into `~/.automaton/marks/` (or `AUTOMATON_HOME`) before the row is visible. Seed trio stay graphite blob/hex/tablet with five still poses.
- Live Kernel analyze: `bun scripts/probe-kernel.ts` attaches a `job_*` id via `run --config`. Nested Cursor-agent shells can see SDK `status:error`; native `bun --hot src/main.tsx` is the spawn host.
- Staff mouth: `bun scripts/probe-mouth.ts` (OpenRouter; key from Automaton or Marionette). Query-first claims are unit-tested with no HTTP.
- Kernel implement contract is unit-tested (`writeImplementConfig` cwd outside checkout, git worktree seed). Do not `--implement` on this checkout.

## Drive

Stable handles (GPUIX `testId`):

- `agent-staff`, `agent-kernel`, `agent-research`
- `blob-staff`, `blob-kernel`, `blob-research`
- `composer`, `send`, `attach`, `pending-files`, `pending-drop-0`
- `job-strip`, `stop-<jobId>`
- `fanout-confirm`, `fanout-confirm-yes`, `fanout-confirm-no`
- `delete-confirm`, `delete-confirm-yes`, `delete-confirm-no`
- `new-agent`
- `titlebar`, `titlebar-name`, `inspector`, `inspector-close`, `inspector-mouth`, `inspector-mark`, `inspector-kit`, `inspector-rules`, `inspector-skills`, `inspector-desktop`, `desktop-refresh`, `inspector-claims`, `inspector-job`, `inspector-ledger`
- `query-hit`
- `settings-open`, `settings`, `settings-close`, `settings-usage`, `settings-keys`, `settings-secret-request`, `settings-key-input`, `settings-key-save`, `settings-connectors`, `connector-openrouter`, `settings-theme`

Headless: `createTestRoot()` from `@gpuix/react/testing` plus `captureScreenshot`. Live: click the rail, type in the composer, Enter/Send.

## Evidence

- Domain: `bun test` (lock isolation, fan-out confirm, unread on complete, Research analyze vs Kernel implement).
- Native: `artifacts/shots/shell-idle.png` from the shell test.
- Live analyze: `[gpuix] created native window` in the bun log; probe `artifacts/pm-probe.json`.
- Live mouth: `artifacts/mouth-probe.json` (`canned` must be false).
- Native durability: `artifacts/shots/native-window-relaunch.png` shows a Staff thread after quit and relaunch.
- Native query-first: `artifacts/shots/native-window-query-hit.png` shows a stored finding plus `answered from store`.
- Native ledger: `artifacts/shots/native-window-inspector.png` shows the hit, avoided call, and measured miss.

## Native proof

Headless paint and probe output are not substitutes for the window. For the Michael walkthrough:

1. Launch the native window, send one ordinary Staff turn, quit it, and relaunch it. Confirm the same thread remains.
2. Put a provenance-keyed finding in the durable claims store, ask for that finding by owner and task, and confirm the response is marked `answered from store`.
3. Open the inspector with the titlebar click or Cmd+Shift+I. Confirm the ledger increments a hit and avoided call without a new inference.
4. Keep the receipt and screenshots under `artifacts/`. Never print keys or Puppetmaster ids in the note.

The live Kernel probe is a separate gate. A `status:error`, unavailable status stream, or `Didn't land.` result is inconclusive failure evidence, not a successful flying-job proof. Preserve `artifacts/pm-probe.json` and report the external runtime blocker.

## Cleanup

Leave screenshots. Kill only the bun pid this skill started.

## Helpers

```
bun test
bun --hot src/main.tsx
bun scripts/probe-mouth.ts
```
