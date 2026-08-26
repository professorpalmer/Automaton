# Durable Staff mouth

Staff (and non-job Kernel/Research chat) speaks from OpenRouter over sqlite claims plus an 8-message tail. A stored finding is restated with no model call. Puppetmaster is not the chat runtime.

## Sub-features

- Query-first: "what did Kernel find" reads `~/.automaton/staff.sqlite` claims (owner-relevant only; no recent-8 fallback)
- Name/small talk spends OpenRouter (`openai/gpt-4o-mini` unless `AUTOMATON_MOUTH_MODEL`)
- Turn receipts record hit/miss, tokens, and cost. Query-first is zero-call. Unknown provider usage stays unknown.
- Job findings are stored once as `source=job` with the PM job id. Mouth restatements are not claims.
- Key: `OPENROUTER_API_KEY`, else `~/.automaton/keys.json`, else the live `~/.pmharness/state/keys.json`; the legacy `~/.pmharness/keys.json` is last and may be stale.
- Session snapshot survives relaunch

## How to get to it (user POV)

Staff thread. Send `Hello, what is your name?` Answer must not be the old dispatch canned line. After a Kernel job completes, Staff `what did Kernel find` should repeat the stored line without waiting on a worker.

## Driving it

- `bun test tests/mouth.test.ts tests/working-set.test.ts tests/store.test.ts tests/keys.test.ts tests/probe-mouth.test.ts`
- `bun scripts/probe-mouth.ts` writes `artifacts/mouth-probe.json` (seeded zero-call recall, then live OpenRouter if a key exists)
- Native proof: quit and relaunch, then capture a repeated finding with `answered from store` in `artifacts/shots/native-window-query-hit.png`

## Gotchas

Do not turn "what is your name?" into a Puppetmaster job. Jobs stay `run --config`. Nested Cursor-agent CLI is not the mouth host; native `bun --hot src/main.tsx` is. Steal OpenRouter from `~/.pmharness/state/keys.json` (live). Legacy `~/.pmharness/keys.json` can 401.
