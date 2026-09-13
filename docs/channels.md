# External channels (Slack MVP)

Automaton can wake a mouth from Slack mentions/DMs and reply as you.
Channel traffic is **mouth/staff** — Jobs and Puppetmaster still own coding.
There is no parallel Slack jobs lane.

Version stays `0.1.0`.

## Connect (Settings)

1. Open **Settings → Channels → Slack**.
2. Paste the **bot token** into the secure field (same pattern as OpenRouter).
   Never paste a bot token into the chat mouth.
3. **Connect** writes `~/.automaton/secrets/slack.json` (chmod 600) and
   updates `~/.automaton/channels.json` (public status only — no tokens).
4. **Disconnect** clears the secret and marks Need auth.

Hooks exist for more platforms via `Channel.platform`; MVP is Slack only.

## Inbound

Two paths:

### File-drop inbox (MVP, no ngrok)

Drop JSON events into `~/.automaton/inbox/slack/*.json`. While Staff is open,
a tick (~45s, alongside routines) drains the folder, calls
`ingestSlackInbound` → `enqueueChannelInbound` with `kickoff=channel`
(unattended like webhook), and wakes Staff.

Example event:

```json
{
  "channelId": "C0123456789",
  "user": "U9876543210",
  "text": "what's the status on the release?",
  "isDm": false,
  "roomName": "ship",
  "threadTs": "1710000000.000100"
}
```

Processed files move under `inbox/slack/processed/`.

A tiny helper or Slack Events / Socket Mode bridge can write these files
outside the app. Production Socket Mode can land later — the app does not
require heavy Socket Mode deps for MVP.

### Future Socket Mode

Optional `appToken` may be stored next to `botToken` for a later socket
listener. Not wired in-app for MVP.

## Outbound

- Only when the user asked, a routine requires it, or the inbound was marked
  `expectReply` (default for mention/DM).
- Speaks **as Cary** (first person / as your accounts) — not third person.
- After the mouth completes a channel-origin turn, the app calls
  `sendSlackMessage` to the same Slack conversation (and thread if present).
- **Fail closed**: disconnected / Need auth / missing channel → Need in the
  UI; never invent delivery.
- Private staff chatter (agent notes, job ids, internal relays) is not dumped
  to Slack.

## Honesty

| State | Behavior |
| --- | --- |
| Disconnected / needsAuth | Need + pause; no send |
| Channel missing | Fail closed |
| Post API error | Need note on the mouth; do not pretend sent |

## Surfaces

| Concern | Owner |
| --- | --- |
| Mention/DM wake + reply | Mouth / Staff (`kickoff=channel`) |
| Coding work | Jobs / Puppetmaster |
| Bot token | Settings secure field → `secrets/slack.json` |

See also [Routines](routines.md) (Slack event triggers need Slack grant) and
[Staff surface](staff.md).
