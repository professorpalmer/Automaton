# Idle CPU proof (P1.6)

With Automaton open, no stream, feed at rest — the process must not multi-core
thrash. Parks already shipped in prior PRs; this page is the re-verify contract.

Package / Info.plist are **0.4.0** (P2 band cut).

## Measured (2026-09-12 CT, Cary’s MacBook Pro)

| Condition | Value |
| --- | --- |
| Host load averages | ~5.5 / 8.1 / 9.4 (busy machine) |
| Process | `Automaton …/src/main.tsx` via `bun run app` |
| Settle wait | ≥12s after open (springs ≤420ms; Staff glance continues) |
| `ps` %CPU shortly after open (1s × 10, ≥12s settle) | **~5.5–8.5%** of one core (mean ≈6%) while springs/glances settle |
| `bun scripts/sample-idle-cpu.ts` after ~2.5 min at rest | **mean ~0.2%** (samples mostly 0, one 1.4) |
| CPU time / wall (first ~54s) | ~4.3s / 54s ≈ 8% average during settle |
| `sample` call graph (settle window) | Dominated by `GpuixRenderer::tick` → AppKit `CFRunLoop` / `mach_msg` wait — **not** invalidate→layout→draw thrash |
| Verdict | **No multi-core thrash at rest.** Parks already held — no new thrash fix required. Deep idle ≈ paced baseline. |

Honesty: do not claim a forever-0% process. Paced GPUIX baseline is ~**1.5%** (vs ~73% with a `setImmediate` spin). Selected Staff may still glance; idle sisters freeze. Report both settle and deep-idle samples.

## Park inventory

| Id | Where | What parks |
| --- | --- | --- |
| `spring-lease` | `src/resting-motion.ts` + vendored `@gpuix/react` MotionDiv | Spring / StickSpring ticks unsubscribe at rest (settle ≤420ms); integer-pixel publish |
| `sister-freeze` | `src/blob.tsx`, `alive = selected \|\| working` | Idle sisters drop wander/blink/melt; selected Staff may glance + soft `restMelt`; springs immediate when frozen |
| `stream-commit` | `src/runtime/feed-pin.ts` | 120ms STREAM_COMMIT coalesce + `FEED_TAIL` pin |
| `row-fingerprint` | `src/runtime/feed-row.ts` | Fingerprints avoid wholesale rebuilds on last-line growth |
| `frame-pace` | vendored `@gpuix/react` `startFrameLoop` | 8ms paced AppKit pump (PulseClock lease = spring `onFrame` listeners empty → GPUI can park) |

Code mirror: `idleParkInventory()` in `src/runtime/idle-health.ts`.

## Re-verify checklist (manual)

1. `bun run app` (cold; reclaim zombies).
2. Focus Staff, no stream, feed at rest. Wait ≥10s.
3. Activity Monitor: Automaton / `runtime` — expect low single-digit %CPU, not multi-core.
4. Or: `bun scripts/sample-idle-cpu.ts` → JSON with `status: ok|warn|skip`.
5. Optional live doctor sample: `AUTOMATON_IDLE_CPU=1 bun run doctor` (WARN-only; never flips `ok` alone).
6. If hot (≥40% sustained): hunt remaining invalidate→layout→draw (titlebar, feed rebuild, spring not parking, timer). Do **not** add another animation library. Prefer Automaton-side or vendored `@gpuix/react` park path; do not publish `@gpuix`.

## CI

`bun test` covers park/coalesce invariants. GUI CPU sampling **soft-skips** when no live process or under `CI=true` / `AUTOMATON_SKIP_IDLE_CPU=1`. Never fail the suite for missing Mac GUI metrics.

## Vendor pin

Idle parks that depend on MotionDiv lease-park stay on vendored
`@gpuix/react` 0.6.1. Do **not** drop onto npm `@gpuix/react@0.7.0` (no
`motion-spring` in dist). Hold until [remorses/gpuix#34](https://github.com/remorses/gpuix/pull/34)
merges **and** a park-bearing release publishes — see [`docs/gpuix.md`](./gpuix.md).

## Out of scope

Rust rewrite, Loro, Xvfb scroll myths, private Anysphere kits, Discord OS,
bumping the 0.4.0 band, publishing `@gpuix`, asking for `NPM_TOKEN` for that scope.
