# Slack inbox drop (MVP inbound)

Automaton drains `~/.automaton/inbox/slack/*.json` while Staff is open.
Use this instead of in-app Socket Mode for local/dev bridges.

```sh
mkdir -p ~/.automaton/inbox/slack
cat > ~/.automaton/inbox/slack/$(date +%s).json <<'JSON'
{
  "channelId": "C0123456789",
  "user": "U9876543210",
  "text": "ship status?",
  "isDm": false,
  "roomName": "eng"
}
JSON
```

Within ~45s Staff should wake with `kickoff=channel`. Reply posts back only
when Slack is Connected in Settings.

A Slack Events API or Socket Mode process can write the same JSON shape.
See `docs/channels.md`.
