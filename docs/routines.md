# Routines

Product routines wake a named mouth on a **schedule** or an **event trigger**
(GitHub / Slack / webhook shapes). A routine is always one or the other —
never both. This is Automaton product surface, not Grok Bot agent crons and
not Cursor-private APIs.

## Model

- `name` + `prompt` (intent)
- `schedule` — cron, `@daily`, `@hourly`, or a named time in the user TZ
  (`America/Chicago`), **or**
- `trigger` — `{ type: 'github' | 'slack' | 'webhook', ref?, event? }`
- Lifecycle: create / update / pause / resume / delete
- `enabled`, `lastRunAt`, optional `lastError`
- Optional `finite` + `terminalOn` (e.g. `pr-merged`) — after a terminal fire
  the routine auto-pauses (MVP helper; delete is available from Settings)

Persisted under `~/.automaton/agents/<id>/automations/<routineId>/automation.json`.

## Defaults

| Input | Resolution |
| --- | --- |
| Vague `@daily` / `daily` | Weekdays **09:00** America/Chicago |
| `@hourly` | Every hour at the **wall-clock minute of creation** |
| Named times (`9:00`, `weekdays 9:30am`) | Exact local time |
| Five-field cron | Matched in America/Chicago |

Prefer documenting **event triggers** (PR opened, Slack mention, webhook) over
inventing in-process polling for PR/CI.

## Fire path

1. Staff app ticks every ~45s (in-process MVP).
2. Due schedule routines call `enqueueRoutineFire` with `kickoff=routine`.
3. The mouth wakes on the saved prompt. Staff does **not** speak
   “routine triggered”. Composer stays **Send**.
4. If the prompt contains stay-quiet / nothing-changed language and the mouth
   returns empty, the result stays empty (no `Done.` filler).
5. Event routines that need a connector (GitHub / Slack) and lack auth pause
   once with `lastError` Need — they do not spam every tick.

Kickoff sources already in `TurnKickoff` (`routine` / `webhook` / `peer-hop`)
show as first-class routine rows when stored; Settings labels those sources.

## Limitation (MVP)

Schedule fires run **in-process while the Staff app is open**. A cold /
quit app does not tick. Document this honestly; a later pass can move the
scheduler out of the UI process. Version stays `0.1.0`.
