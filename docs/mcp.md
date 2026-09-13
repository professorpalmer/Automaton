# MCP catalog (in-app plugins)

Browse / install curated Model Context Protocol connectors from Settings.
Version follows package (`0.4.0` after P2 cut).

This is **not** the OpenRouter Connectors row. OpenRouter is the mouth HTTP
provider (`src/runtime/connectors.ts`). MCP entries are a separate catalog
with a local install registry under `~/.automaton/mcp/`.

## Catalog vs OpenRouter

| Surface | Role |
| --- | --- |
| **Settings → Connectors** | OpenRouter (and future HTTP connectors). Mouth completions. |
| **Settings → MCP catalog** | Curated MCP servers (GitHub, filesystem, Puppetmaster, memory, …). |

Never invent marketplace / Cursor-private plugin IDs. The catalog is
`CURATED_CATALOG` in `src/runtime/mcp-catalog.ts` — small, honest, documented
packages only. Empty search or a failed catalog read shows a clear **Need**,
not invented rows.

## Install registry

| Path | Contents |
| --- | --- |
| `~/.automaton/mcp/installed.json` | `{ id, installedAt, status, lastError? }[]` |
| `~/.automaton/mcp/secrets/<id>.grant` | Write-only grant for `needsAuth` entries |

Status chip: `available` \| `installed` \| `needsAuth` \| `error`.

| API | Role |
| --- | --- |
| `listCatalog({ query? })` | Browse / filter curated rows + status |
| `installMcp` / `uninstallMcp` | Persist registry; unknown id → Need |
| `mcpStatus` / `listInstalled` | Installed rows only |
| `discoverTools` / `discoverSchemas` | Schema hints for installed ids |
| `callMcpTool` | **Stub** — documents live call not wired |

Installed ids are callable **namespaces** in the registry even while the MCP
runtime is a thin MVP (hints + stub).

## Auth (never chat-paste)

Entries with `needsAuth: true` install as `needsAuth` until Connect succeeds.

Reuse the existing connector secret path:

- Settings **Connect** field → `writeConnectorSecret` → `writeMcpSecret`
- Mouth `{"type":"secret-request","connectorId":"<mcp-id>"}` → `emitSecretRequest`
  / `fulfillSecretRequest` (same cards as OpenRouter)

`knownConnectorId` accepts installed auth MCP ids so secret-request works.
Never ask the user to paste a token in chat.

## Schema discover before call

`discoverTools(id)` returns declared tool names from a local `SCHEMA_HINTS`
map (published docs) for **installed** entries. Not installed → empty tools +
**Need**. Live MCP stdio/HTTP client is **not** wired in 0.4.0; `callMcpTool`
returns an honest stub message after schema + auth checks. Do not scrape
cookies or invent transports.

## Mouths vs Jobs

| Concern | Owner |
| --- | --- |
| Catalog browse / install / Connect | Settings (staff surface) |
| Durable coding work | Jobs / Puppetmaster |
| Mouth using an MCP namespace later | Future; stub only today |

## Honesty

| State | Behavior |
| --- | --- |
| Empty search | Need — no matching curated entries |
| Unknown install id | Need — not invented |
| Auth missing | Need auth chip + Connect |
| Discover before install | Need: install first |
| Catalog fetch / parse fail | Empty list / Need — never fake plugins |
| Live tool call | Stub + docs (this page) |

## Curated entries (MVP)

- **github** — `@modelcontextprotocol/server-github` (deprecated npm; prefer
  `ghcr.io/github/github-mcp-server`); PAT via Connect
- **filesystem** — `@modelcontextprotocol/server-filesystem`
- **puppetmaster** — `puppetmaster-ai` (`python -m puppetmaster.mcp_server`)
- **memory** — `@modelcontextprotocol/server-memory`

See also [Secrets](secrets.md) for the shared secret-request / Connect UX.
