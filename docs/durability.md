# Durable state

Runtime state lives under `~/.automaton/` (override with `AUTOMATON_HOME`).
That directory is not the git checkout.

| Path | Role |
| --- | --- |
| `staff.sqlite` | Session snapshot, claims, turn receipts, attachments |
| `keys.json` | OpenRouter key written from Settings. Mode 600. Gitignored. |
| `connectors.json` | Connector catalog and last probe |
| `desktops/` | Per-automaton Chrome profiles and captures |
| `sandboxes/` | Isolated implement worktrees |
| `agents/` | Per-automaton `profile.json` (kit, home repo, mark) |
| `marks/` | Baked blob frames |

The domain snapshot is JSON in SQLite (`src/runtime/store.ts`). Claims are
query-first: a later mouth turn may speak a stored finding instead of
paying for inference. Receipts record hit/miss and token totals when the
provider sent them. Unknown cost is not stored as zero.

Do not commit `keys.json`, `*.sqlite`, or tenant secrets. The repo
gitignore already covers those.
