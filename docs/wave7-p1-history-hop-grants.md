# Wave 7 P1 — Interrupt history hygiene + hop `mayAddress` grants

**Status:** Implemented on branch `feat/wave-7-p1-history-hop-grants`.  
**Policy:** Steal **patterns only** from CopilotKit/OpenBot. No `@ag-ui/*`, no
CopilotKit npm, no generative UI / sandboxed iframes. Mouths = OpenRouter;
Jobs = Puppetmaster. Native `@gpuix/react` only. Sisters stay separate.

Do **not** cut a release tag in the P1 PR (v0.16.0 / v0.17.0 wait on coordinator).

## P1a — History hygiene after Stop / interrupt

| OpenBot | Automaton |
| --- | --- |
| `history-sanitize.ts` / drop dangling tool calls | `src/runtime/history-sanitize.ts` |
| UI transcript kept; provider seed filtered | Feed rows stay; terminal refuse appended |

- On **Stop** / `failMouth` / `failComputer`: in-flight mouth-stream arcs
  (`decide` / `act` without a later `done` / `refuse` for that tool+intent)
  get a terminal **`refuse`** row with detail `Stopped.` (or the fail sentence).
- `scrubIncompleteToolPairs` drops unanswerable provider tool call/result
  pairs from seeded history. Does **not** invent fake successful tool results.
- Person-visible feed rows are **never** deleted.
- Sticky `stoppedReason` (P0c) still parks until the next Send.

## P1b — Hop `mayAddress` grants

| OpenBot | Automaton |
| --- | --- |
| `mayAddress(from, to)` per hop + spoken refuse | `AgentProfile.mayAddressIds` + `Room.mayAddressIds` |
| `agent.handoff_refused` audit | `pendingLedger` → `action_events` (`hop` / `not_granted`) |

- Optional allowlist on the **asking** agent profile (mirrored on live `Agent`).
  Missing / undefined = **all visible sisters** (preserve current UX).
  Explicit `[]` = nobody.
- Optional `Room.mayAddressIds` is data for Settings later (P1 stores + normalizes).
- `offerSisterHop` / `sendToAgent` check grants → spoken
  `Not allowed to hand that to {Name}.` + ledger refuse (no throw mid-run).
- Not SPIRE / cluster leases / work-owner claiming.
- Settings UI can wait (P2); P1 is data + enforce.

## P1c

Absorbed into Wave 7 P0 hop ToolLine cards — no extra work here.

## Out of scope (P2+)

Hold cancelled-vs-refused, computer activity epoch auto-open, proposed-sister
consent, richer ledger event zoo — see
`artifacts/automaton-wave7-openbot-parity-audit.md`.

## Tests

`tests/wave7-p1.test.ts` — interrupt mid-act → terminal refuse → next send;
scrub dangling tool pairs; grant refuse spoken + ledger; default open grants.
