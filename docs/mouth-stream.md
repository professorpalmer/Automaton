# Mouth stream

Automaton-native feed events for **side-effect steps** on a mouth turn:
`decide → act → done`, or `decide → refuse`. Inspired by AG-UI’s tool/step
stream — **not** an AG-UI SDK, CopilotKit, or animation dependency.

Mouth stream is **mouth chrome**, not Jobs. Jobs stay on the Jobs strip /
Puppetmaster board (`docs/jobs.md`). Sister threads stay separate: a stream
row lands only on the automaton that ran the tool.

## Feed kind

```ts
{ kind: 'mouth-stream', phase, tool, intent, detail?, agentId, id, at? }
```

| Field | Role |
| --- | --- |
| `phase` | `decide` \| `act` \| `done` \| `refuse` |
| `tool` | Computer / host tool name, or `mcp:<id>` |
| `intent` | Short verb (`shell`, `read`, `browse`, …) |
| `detail` | Path / host / MCP id only |

**Never** put secrets, typed text, stdout, file bytes, or grant values in
`detail` or any stream row. Same honesty as the action ledger and
`docs/secrets.md`.

Paint is a quiet tertiary line in the feed (`decide · box_shell · shell`),
danger-tinted on `refuse`. No new motion libraries.

## Action ledger initiator

Every durable `action_events` row carries `initiatorKind`, mapped from the
turn kickoff that booked the work:

| Kickoff | `initiatorKind` |
| --- | --- |
| `user` | `person` |
| `routine` | `routine` |
| `peer-hop` | `peer-hop` |
| `channel` | `channel` |
| `webhook` | `webhook` |
| (future deploy wake) | `deployment` |
| `intro` / missing | `unknown` |

Computer, host, and MCP permit/refuse paths share one helper
(`recordSideEffect` / `finishSideEffect` in `src/runtime/mouth-stream.ts`).
The ledger is audit; the feed stream is ephemeral paint of the same
decide→act→done/refuse arc.

## Session Activity (P2)

Ephemeral per-sister commands/files strip next to the feed is derived from
these mouth-stream rows (and optionally `listActions`) — see
[Activity](activity.md). Write steps may carry `bytes` (size only).

## Out of scope here

- Cutting **v0.11.0** (coordinator)
- Adopting `@ag-ui/*` or CopilotKit packages
- Collapsing sister transcripts

See also [Activity](activity.md), [Computer](computer.md), [Jobs](jobs.md),
[Wave 4 lift](wave4-openbot-lift.md).
