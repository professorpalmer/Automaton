# Cloud agent / Origin (optional, public only)

Package **0.8.0**. Cloud agent and Cursor Origin are an **opt-in** Jobs /
Settings transport — not required for the local Docker box or Mac staff.
Local Puppetmaster jobs still own durable analyze / implement. Mouths stay
Send. Fail soft when the public API is unavailable.

## Honesty contract

| Rule | Detail |
| --- | --- |
| Public only | Uses the documented [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/v0) at `https://api.cursor.com/v0` with `CURSOR_API_KEY` (Basic auth). **No** private `@anysphere` packages, no inventing Cursor-internal endpoints, no vendored private kits. |
| Opt-in | Missing key → Settings/Jobs show **parked · no CURSOR_API_KEY**. No fake Launch button that no-ops. |
| Privacy Mode | Some accounts still on Privacy Mode (Legacy) cannot launch Cloud Agents. Doctor / UI report **parked · privacy mode** with this doc — switch Privacy Mode in the Cursor dashboard to enable later. |
| Jobs stay Jobs | Strip + open board remain Puppetmaster. Cloud launch is another transport beside local PM implement. |
| Origin forge | Browse / PR links only when a checkout already has an `origin.cursor.com` remote. **Never** guess Origin slugs from GitHub. **Never** force-mirror Origin → GitHub for deploys. |

## Enable later

1. Create a Cursor API key from [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api) (Cloud Agents–capable key).
2. Export it for the Automaton process: `export CURSOR_API_KEY=…` (or launch the Mac app from a shell that already has it).
3. Confirm the account can use Cloud Agents (not Privacy Mode Legacy).
4. Bind a mouth home to a **github.com** repo (`Point Kernel at https://github.com/…`).
5. Open **Jobs** or **Settings → Cloud / Origin**. When the probe is `ready` and a bind exists, **Launch cloud implement** POSTs `/v0/agents`, polls status, and surfaces the agent URL + PR link when present.

Live doctor probe (optional, network):

```sh
AUTOMATON_CLOUD_PROBE=1 bun run doctor
```

Default `bun run doctor` prints a parked checklist note and does not call the network (CI-safe). Cloud status never alone flips `DoctorReport.ok`.

## Origin

Origin is Cursor’s early-beta git forge (`origin.cursor.com` clone URLs;
browse at [cursor.com/codebase](https://cursor.com/codebase)). Automaton only
exposes Browse Origin when `git remote get-url origin` on the bound checkout
already points at Origin. GitHub binds stay GitHub for Cloud Agents launch
(`source.repository` is a github.com URL per the public API).

## Code map

| Piece | Path |
| --- | --- |
| Probe / launch / poll / Origin parse | `src/runtime/cloud-origin.ts` |
| Settings + Jobs panel | `src/cloud-origin-panel.tsx` |
| Doctor fields | `src/runtime/doctor.ts` (`cloud`, `cloudNote`) |
| Tests | `tests/cloud-origin.test.ts` |

## Related

- Jobs board: [`docs/jobs.md`](./jobs.md)
- Contributor invariants: `AGENTS.md`
