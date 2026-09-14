# Multi-agent rooms (SendToAgent-class)

Local in-app rooms and 1:1 peer messaging between automata.
Version follows package (`0.7.0`).

This is **not** Slack / external channels (`docs/channels.md`). Rooms live under
`~/.automaton/rooms.json` and only wake mouths inside Automaton.

## SendToAgent (1:1, async)

`sendToAgent(session, fromId, toId, text)`:

1. Appends a **sent** relay + speaks **Sent.** on the sender thread (ack).
2. Appends an `agent_note` on the target thread.
3. Wakes the target mouth with a user turn `kickoff=peer-hop`, carrying peer provenance:
   - `originUser` — interactive person started this chain (from sender turn / prior hop)
   - `hopDepth` — increments from the sender's last user turn (first hop = 1)
4. Returns immediately — **no live RPC**; the reply arrives later as a normal mouth turn.

Empty text is a no-op (do not auto-ack empty). Peer/room traffic is **mouth** only;
Jobs / Puppetmaster stay untouched.

Build path reuses existing `agent_note`, fanout-style relays, and sister mouth wake
patterns (`wakeSisterMouth` / peer-hop kickoff).

## Rooms

A room is `{ id, name, memberIds, archived?, createdAt, updatedAt }`.

| API | Role |
| --- | --- |
| `listRooms` / `createRoom` / `updateRoomMembers` / `renameRoom` | CRUD |
| `archiveRoom` | Soft pause (prefer over silent drop) |
| `deleteRoom` | Hard delete from Settings |
| `postToRoom` | Pure delivery list (excludes sender); optional `originUser` / `hopDepth` on each delivery |
| `sendToRoom` | Session fan-out: notes + peer-hop wake per member (stamps provenance) |

`postToRoom` → `sendToRoom` paints each **member on their own thread**. Sisters do
**not** share one collapsed transcript — every seat keeps a separate feed; room posts
appear as `agent_note` (+ peer-hop wake) on each member thread.

When a user send path would reach **3+ other members**, use the same bar as
`needsFanoutConfirm` (`pendingRoomPost` + confirm). Do not fan out unless the user
asked. Optional `sanitizePeerRelay(text)` strips obvious vent phrasing before relay;
do not ship private venting helpers as product surface.

## Settings

**Settings → Rooms**: list rooms and members, Archive / Delete, create with name +
multi-select visible automata. MVP create lives here (chat phrases can wait).

## Surfaces

| Concern | Owner |
| --- | --- |
| 1:1 peer message / room post | Mouth (`kickoff=peer-hop`) |
| Coding work | Jobs / Puppetmaster |
| Slack mention/DM | Channels (`docs/channels.md`) — separate P0.6 |

## Honesty

| State | Behavior |
| --- | --- |
| Empty text | No-op |
| Unknown / archived room | `sendToRoom` no-op; `postToRoom` throws |
| Sender not a member | `postToRoom` throws |
| Large fan-out (user path) | Confirm via `needsFanoutConfirm` / `pendingRoomPost` |
| Peer-hop with `originUser` | Attended for Auto (person still watching) |
| Peer-hop without `originUser` / routine | Unattended — Auto cannot swallow |
