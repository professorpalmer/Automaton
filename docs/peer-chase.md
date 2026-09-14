# Peer chase (Wave 5 P0)

Head keep-alive after an async sister hop. Stolen from OpenBot's hop + relay
pattern (`handoff-runner` re-wakes the asking bot when the addressee finishes
or fails) — **behavior only**, not CopilotKit / `@ag-ui/*` packages.

Sisters keep separate threads. This is **not** block-until-peer-done: the hop
returns immediately (`Handed to …` / `Sent.`), the head stays working while
`pendingHops.length > 0`, and assess re-wakes automatically when the last
sister lands.

## Why

Staff→Dugout “SSH EC2 stats” used to assess as copy: the sister’s connect
narrative was paraphrased, the hop ended, and the user had to say “and?”.
Ideal: the head keeps driving until the user-facing answer meets the hop’s
`expecting`.

## Pending hops

Every handoff path parks the target on the coordinator thread:

| Path | Who marks |
| --- | --- |
| Enter dispatch / fan-out / home ping | `markPendingHops` (already) |
| Typed `{"type":"hop",…}` / `offerSisterHop` | `addPendingHop` |
| `sendToAgent` / `sendToRoom` | `addPendingHop` |

`pendingHops` holds the envelope (`to` + `task` / `constraints` / `expecting`)
until drop. Snapshots that stored bare ids hydrate via `normalizePendingHops`.
The rail treats `pendingHops.length > 0` as working (`isSeatWorking`) even
when the mouth is idle.

Assess still waits until the list is empty (`maybeWakeAssess`). Drop happens
on sister return / fail / empty — the envelope is stamped onto the
`from`-relay so the chase prompt still sees `expecting`.

## Chase vs copy

`assessAsks` injects the peer answer **and** the original `expecting`.

| Sister return | Head prompt |
| --- | --- |
| `expecting` missing, or met (`expectingMet`) | Copy: “You are copy, not the scheduler.” |
| `expecting` unmet (empty, or stats/numbers with no digit) | Chase: hop again within `HOP_MAX_DEPTH` / `HOP_MAX_PER_TURN`. “You are the scheduler for this chase, not copy.” |
| Empty / `failMouth` | Notice: tell the person it did not come back. No user nudge. |

Chase hops are ordinary hop emits. Caps still refuse instead of truncating.

## Terminal notice

Empty spoken or `failMouth` on a sister that a coordinator is waiting on
does **not** leave the head idle. `coordinatorReturn(..., failed)` writes a
`from`-relay (`Kernel did not come back (task).`) and auto-wakes assess with
the notice prompt.

## Honesty

- Async: hop ack is not the sister’s answer.
- Do not collapse sister threads.
- Unattended Auto still fails closed (`docs/rooms.md`).
- No CopilotKit Intelligence / AG-UI SDK.
