# Secrets (secure secret-request UX)

When Staff needs a key or token, mouths emit an in-app **secret-request** card —
never ask the operator to paste into chat.

Version stays with package (`0.4.0`).

## Card

| Prop | Role |
| --- | --- |
| Connector label | Display name (`connectorDisplayName`) |
| description | Optional help under the label |
| fieldLabel | e.g. API key / Token |
| storeHint | Vault path hint (`~/.automaton/keys.json` or `mcp/secrets/<id>.grant`) |
| Masked field | Bullet-obscured single-line input (GPUIX 0.6.1 has no `secureTextEntry`) |

Placeholder: **Enter key — stays out of chat**. Draft clears from React state
immediately after save.

## Submit path

1. Card `onSave` → `fulfillSecretRequest`
2. `writeConnectorSecret` / vault (`keys.json` or MCP `.grant`)
3. Feed item status → `saved` / configured; UI confirms **Provided** only
4. **Never** put the secret value into SQLite session JSON, feed items, Jobs
   notes, Slack outbound, or spoken text

`normalizeSession` + `scrubSecretRequestItem` strip accidental secret-bearing
keys on load.

## Dismiss / decline

Dismiss sets `dismissed` and speaks once: **Still need a connector grant.**
It does **not** re-emit another open card. `emitSecretRequest` refuses to stack
a second open card for the same connector on that mouth.

## Missing secret

Fail closed as Need. No Keychain scrape, no cookie scrape, no chat-paste
fallback.

## Surfaces

| Surface | Path |
| --- | --- |
| Mouth staff path | `{"type":"secret-request","connectorId":"…"}` → card |
| Settings OpenRouter | Local masked field → same `writeConnectorSecret` / `keys.json` |
| Settings MCP Connect | Local masked field → same vault (`mcp/secrets/<id>.grant`) |

See also [MCP catalog](mcp.md) and [Channels](channels.md) (Slack bot token).
