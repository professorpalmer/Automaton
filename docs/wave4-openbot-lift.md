# Automaton Wave 4 — OpenBot pattern lift (audit)

**Status:** Cary greenlit full auto 2026-09-14. Steal **patterns only** from [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot). No CopilotKit Intelligence dependency, no React/Vite shell, no framework-soup agents.

**Ship style:** Wave 2 rinse-repeat — when CI green, merge P-band, cut release, start next. CloudAgent on `professorpalmer/Automaton` (not Puppetmaster). Personal Git identity only.

**Do not:** Collapsing sisters into one shared transcript; npm `@gpuix` jump; publishing secrets in feed.

## Already Automaton

| Capability | Where |
| --- | --- |
| Per-sister computer + Take control | `docs/computer.md`, desk |
| Mouths / Jobs split | `docs/jobs.md`, `docs/providers.md` |
| Rooms + async `sendToAgent` / peer-hop | `docs/rooms.md` |
| Fan-out confirm 3+ | `needsFanoutConfirm` |
| Kickoff kinds | `user` / `webhook` / `routine` / `channel` / `peer-hop` / `intro` |
| Unattended ≠ Auto | `src/runtime/auto-approve.ts` |
| Mouth stream + initiator ledger | `docs/mouth-stream.md` (P0) |
| Peer provenance + standing role | `docs/rooms.md` (P1) |
| Session Activity strip | `docs/activity.md` (P2) |
| Head chase / hop keep-alive | `docs/peer-chase.md` (Wave 5 P0 (shipped v0.12.0)) |

## Gap (what OpenBot does better)

1. **Agent↔user stream protocol** — tool calls, generative UI, decide→act→done as first-class events (AG-UI), not prose-only bubbles.
2. **Single side-effect gateway** — every browser/file/MCP call: resolve → policy → audit → act/refuse; initiator `person` / `routine` / `handoff`.
3. **Peer handoff provenance** — depth + who started the conversation survives Staff→sister hops.
4. **Standing role every run** — title + role_description injected as system content on every mouth wake.
5. **Activity vs audit** — ephemeral “what this sister just ran” vs durable ledger.

## Bands

### P0 — Mouth stream + initiator ledger ✅ done
- Feed/event model for tool/side-effect steps (Automaton-native; AG-UI-*inspired*, not AG-UI SDK).
- Action ledger rows carry `initiatorKind`: `person` | `routine` | `peer-hop` | `channel` | `webhook` | `deployment` (map from existing kickoff).
- Wire computer / host / MCP permit paths through one record helper (extend existing action-ledger tests).
- Docs: `docs/mouth-stream.md` + ledger honesty in `docs/computer.md`.
- **Ship:** merge → cut **v0.9.0** (coordinator).

### P1 — Peer provenance + standing role ✅ done
- `sendToAgent` / `postToRoom` propagate `originUser` + `hopDepth` on peer-hop wakes.
- Inject standing role (name/title/rules) on every mouth system preamble (`standingRoleBlock`).
- Unattended filter: “nobody watching” = routine | peer-hop without interactive person (`originUser`); other non-user kickoffs stay fail-closed.
- Docs: `docs/rooms.md`, this file, `AGENTS.md`.
- **Ship:** merge → cut **v0.10.0** (coordinator; may already be cut).

### P2 — Activity surface ✅ done
- Per-sister Activity strip (commands/files this session) next to feed; not a second audit DB.
- Paths/sizes only for writes (no secret contents); aligns with secrets policy.
- Derive from mouth-stream feed + existing action ledger (`src/runtime/session-activity.ts`); optional `bytes` on writes.
- Docs: `docs/activity.md`, this file, `AGENTS.md`, `docs/mouth-stream.md`.
- **Ship:** merge → cut **v0.11.0** (coordinator).

### Wave 5 P0 (shipped v0.12.0) — Head chase / peer-complete keep-alive (in progress)
- Pending hop on every handoff path (`offerSisterHop`, `sendToAgent`, Enter dispatch); head working while `pendingHops.length > 0`.
- Persist hop envelope (`task` / `constraints` / `expecting` + target) until drop; stamp onto `from`-relay for assess.
- Assess chase: inject peer answer **and** original `expecting`; unmet → another hop emit within `HOP_MAX_*`; met/missing → copy. Flip “not the scheduler” on chase turns.
- Terminal notice: empty / failed sister auto-wakes the head (no user “and?”).
- Docs: `docs/peer-chase.md`, `docs/rooms.md`. Patterns only — no CopilotKit / `@ag-ui/*`.
- **Ship readiness:** later cut a version (do not tag here).

## Parked
- Adopting CopilotKit Intelligence / AG-UI npm packages
- OpenBot Docker supervisor / SPIRE
- Multi-framework agent images

## Success for Wave 5 P0 (shipped v0.12.0)
- PR open + CI green + tests for unmet chase hop, met copy-once, empty-sister notice, pendingHops set/cleared
- No CopilotKit deps in `package.json`
- Sister threads remain separate; hops stay async (not block-until-peer-done)

## Success for P2
- PR open + CI green + tests for session Activity derivation (commands/files, write path+size, no contents)
- No CopilotKit deps in `package.json`
- Sister threads remain separate; no second Activity SQLite table
