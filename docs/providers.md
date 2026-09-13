# Providers

Package **0.6.0**. Automaton’s product-real provider map — which transports
mouths and Jobs may use, and the **one sanctioned auth path** for each.

Code: `src/runtime/providers.ts`. Tests: `tests/providers.test.ts`.

This is **not** `src/runtime/provider-maps.ts`. That file is verified OpenRouter
*reasoning-control* maps (Grok / Claude / Gemini / …) — verified-or-none; no
capture, no half-map. The catalog here is provider → auth → models source.

## Mouths vs Jobs/PM vs cloud

| Surface | Who | Default today |
| --- | --- | --- |
| **Mouth** | Staff / sister HTTP chat (`src/runtime/mouth.ts`) | OpenRouter only |
| **Jobs / PM** | Puppetmaster analyze / implement (`src/runtime/pm.ts`, `jobs.ts`) | OpenRouter via agentic (`JOB_PROVIDER=openrouter`) |
| **Cloud** | Optional public Cloud Agents API | Parked until `CURSOR_API_KEY` — see [`cloud-origin.md`](./cloud-origin.md) |

Mouths and Jobs are separate transports. Jobs never appear as chat. Cloud does
not replace the local Puppetmaster strip.

## Catalog

| id | Name | Automaton status | Roles | Sanctioned auth | Models source |
| --- | --- | --- | --- | --- | --- |
| `openrouter` | OpenRouter | **live** | mouth, jobs | `OPENROUTER_API_KEY` or `~/.automaton/keys.json` | OpenRouter `GET /api/v1/models` (`listOpenRouterModels`) |
| `openai-codex` | ChatGPT Codex | **Jobs/PM** | jobs | `OPENAI_CODEX_TOKEN` or `~/.codex/auth.json` (`codex login`) | none in Automaton (no fake picker rows) |
| `cursor-cloud` | Cursor Cloud Agents | **parked** | cloud | `CURSOR_API_KEY` | none (probe in Settings → Cloud / Origin) |

Unknown provider id = **miss** (null / empty). Never invent a selectable mouth
row that no-ops. Discord OS OpenRouter fail-closed is out of scope here.

## Auth honesty (Palmer lock)

- **OpenRouter** — only `OPENROUTER_API_KEY` / Automaton `keys.json` (plus legacy
  Marionette adopt). Missing → Need / secret-request. No cookie scrape.
- **OpenAI-class for Jobs/PM** — **Codex auth only** (`openai-codex` /
  `OPENAI_CODEX_TOKEN` / `~/.codex/auth.json`). Automaton does **not** expose an
  `openai-api` / `OPENAI_API_KEY` path for that class. Puppetmaster’s agentic
  hardens GPT pins onto Codex auth the same way.
- **Cursor Cloud** — `CURSOR_API_KEY` only; parked when unset.

Settings → Providers lists this map with live / Jobs/PM / parked labels.
The model picker stays on the **live mouth** provider (OpenRouter). Codex and
cloud rows are honesty labels — not fake Selects.

## Related

- Reasoning maps: `src/runtime/provider-maps.ts`
- Secrets UX: [`secrets.md`](./secrets.md)
- Jobs board: [`jobs.md`](./jobs.md)
- Cloud / Origin: [`cloud-origin.md`](./cloud-origin.md)
- Contributor invariants: `AGENTS.md`
