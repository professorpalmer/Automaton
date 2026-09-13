# Mouth compaction / working set

Package **0.5.0**. Mouth and Goal threads keep a **compact summary + recent
turns** in the model window — not an unbounded full transcript. Jobs /
Puppetmaster artifacts and status stay on the Jobs strip; compaction never
touches them.

Code: `src/runtime/compact.ts`, `src/runtime/working-set.ts`,
`src/runtime/mouth.ts`. Tests: `tests/compact.test.ts`,
`tests/working-set.test.ts`.

This is **not** a Claude `compact_*` API and not a Cursor private summarizer
kit. Compact runs through OpenRouter on `openai/gpt-4o-mini`
(`COMPACT_MODEL`).

## Working set shape

```
[cached system prefix]   roster / rules / kit — byte-stable for prompt cache
[skill bodies / claims]  dynamic, not in the cache prefix
[compact summary]        optional thread.compactSummary — summarized, not quotes
[recent TAIL turns]      last 8 feed messages (working-set TAIL)
```

UI feed can keep the full thread. Only the OpenRouter mouth request is bound.

## Honesty

After compact, staff must treat the summary as **summarized**, never as
verbatim quotes. The spliced / persisted block is prefixed:

`Compacted history (summarized — not verbatim quotes):`

Compact instructions forbid inventing files, commands, outcomes, or quotes
from dropped turns. Verbatim-recent turns stay after the summary
(`COMPACT_KEEP_TAIL`).

## Triggers

| Knob | Default | Role |
| --- | --- | --- |
| `COMPACT_CHAR_BUDGET` | 24_000 | Auto-compact when working-set chars exceed this |
| `COMPACT_KEEP_TAIL` | 4 | Verbatim turns kept after the summary splice |
| `COMPACT_MIN_MIDDLE` | 2 | Need at least this many dropped middle turns |
| `COMPACT_FAIL_COOLDOWN_MS` | 60_000 | After fail, skip auto retries for this window |
| `SCREENSHOT_PRUNE_EVERY` | 25 | Image prune cadence (not every token) |
| working-set `TAIL` | 8 | Recent feed messages in the set |

Auto path: `ensureMouth` calls `runCompact` when `shouldCompact` before the
live mouth call. Compact runs **once per mouth turn** (batched), not on every
streamed token. Idle GPUI parks (`docs/idle-cpu.md`) are untouched.

## Fail-soft

If the compact pass errors, Automaton **keeps the prior working set**, records
a fail cooldown, and speaks a soft Need (`Need: mouth compact failed — kept
prior working set. Jobs strip unchanged.`). The mouth turn still proceeds with
the uncompacted set when possible.

## Compact now

Settings → **Mouth context** → **Compact now** forces a compact pass for the
focused automaton (`compactMouthNow`). Success persists `thread.compactSummary`
and speaks a short ack. Jobs strip unchanged. Missing key → Need an OpenRouter
key.

## Related

- [Durable state](durability.md) — store, claims, keys
- [Staff surface](staff.md) — rail, composer, Settings
- [Jobs](jobs.md) — analyze / implement (not compacted here)
