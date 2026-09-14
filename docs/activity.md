# Session Activity (Wave 4 P2)

Per-sister **Activity strip** next to the feed: ephemeral commands/files this
session painted beside thinking/job traces. Inspired by OpenBot’s activity
surface — **patterns only**, no CopilotKit / `@ag-ui/*`.

Activity is **not** a second audit database. Rows are derived from:

1. Mouth-stream feed items on that sister’s thread (`docs/mouth-stream.md`)
2. Optionally the existing action ledger (`listActions`) when the feed has no
   stream rows yet

The durable ledger stays the audit source of truth (`action_events`). Activity
is session chrome.

## Honesty

| Kind | What paints | What never paints |
| --- | --- | --- |
| Command | `shell` / `host_shell` intent | argv, typed text, stdout |
| File read | path | file contents |
| File write / copy | path · size (`bytes`) | file contents, secrets |
| Browse | path/URL host | page body |

Write sizes come from optional `bytes` on the action event / mouth-stream step
(via `statBytes` or explicit `args.bytes`). Same secrets policy as
`docs/secrets.md`.

## Takeover

`src/chrome/activity.ts`: auto-open while streaming; header press locks.
After the turn, a sister with session activity keeps a **collapsed** strip
(`hasSessionActivity`) until the operator locks it closed.

## Out of scope

- Cutting **v0.11.0** (coordinator after merge)
- Adopting CopilotKit / AG-UI packages
- Collapsing sister transcripts into one Activity

See also [Mouth stream](mouth-stream.md), [Computer](computer.md),
[Wave 4 lift](wave4-openbot-lift.md).
