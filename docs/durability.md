# Durable state

Runtime state lives under `~/.automaton/` (override with `AUTOMATON_HOME`).
That directory is not the git checkout.

| Path | Role |
| --- | --- |
| `staff.sqlite` | Session snapshot, claims, turn receipts, attachments, goal events |
| `keys.json` | OpenRouter key written from Settings. Mode 600. Gitignored. |
| `connectors.json` | Connector catalog and last probe |
| `desktops/` | Per-automaton Chrome profiles and captures. Bind-mounted into the box. |
| `sandboxes/` | Isolated implement worktrees |
| `agents/` | Per-automaton `profile.json` (kit, home repo, mark) |
| `marks/` | Baked blob frames |

The domain snapshot is JSON in SQLite (`src/runtime/store.ts`). Staff-owned
GoalRuns live on that snapshot (`goals`, default `[]` on old JSON). A
typed `GoalBlocker` may sit on a `waiting_user` GoalRun, with
`source` `staff` | `job` | `host` (old snapshots hydrate to `staff`);
the append-only `goal_events` table is independent durable evidence and
is not an array on Session or GoalRun. Each row records `authority`
(`user_request` | `goal_policy` | `worker_result` | `operator_action` |
`external_state`) for the transition; `source` stays actor/provenance
and `reason` is bounded evidence. Retry is recorded before the
replacement booked job. `StaffStore.save` compares the prior snapshot to
the next session in one transaction, inserts deterministic event rows for
newly observed GoalRun facts, then writes the snapshot. Repeated saves
and store reopen do not duplicate rows. `listGoalEvents(goalId?, limit?)`
reads that ledger and normalizes `authority` at the SQLite boundary.
Event text is bounded and never includes keys or raw
environment. Claims are query-first: a later mouth turn may speak a
stored finding instead of paying for inference. Receipts record hit/miss
and token totals when the provider sent them. Unknown cost is not stored
as zero. Never infer success from a missing event.

Do not commit `keys.json` or `*.sqlite`. The repo gitignore already covers
those.
