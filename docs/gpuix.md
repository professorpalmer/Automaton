# `@gpuix/react` vendor pin (P2.1 honesty)

Automaton stays on **vendored** `@gpuix/react` **0.6.1**
(`file:vendor/gpuix-react-0.6.1.tgz`). Package / Info.plist are **0.7.0**
(Wave 2 P2 band cut). Still vendored 0.6.1 — do not drop onto npm 0.7.0.

## Decision: stay vendored

| Fact | Detail |
| --- | --- |
| Pin today | `package.json` → `"@gpuix/react": "file:vendor/gpuix-react-0.6.1.tgz"` |
| Why vendor | Dist includes spring lease parking (`motion-spring`, `onFrame` park) that P1.6 idle parks need |
| npm latest | `@gpuix/react@0.7.0` on the registry **does not** ship `motion-spring` / lease-park in dist |
| Upstream | [remorses/gpuix#34](https://github.com/remorses/gpuix/pull/34) (`feat/motion-springs`, park commit) is still **OPEN** (mergeable / unstable) |
| Publish | Cary does **not** own the `@gpuix` npm scope. Never ask for `NPM_TOKEN` to publish `@gpuix` |

**Do not** switch the dependency to npm `0.7.0`. Dropping `file:vendor` onto
registry 0.7.0 would lose P1.6 idle parks (`spring-lease` / `frame-pace` in
[`docs/idle-cpu.md`](./idle-cpu.md)).

## When to drop the vendor tarball

Only after **both**:

1. remorses merges [gpuix#34](https://github.com/remorses/gpuix/pull/34) (or equivalent park-bearing work), **and**
2. a park-bearing `@gpuix/react` is **published** to npm

Then: drop `file:vendor/gpuix-react-0.6.1.tgz`, pin the real npm version that
contains lease-park, re-verify idle CPU (`bun run sample:idle-cpu` /
[`docs/idle-cpu.md`](./idle-cpu.md)), and remove this honesty hold.

Until then: keep the vendored tarball; prefer Automaton-side or vendored park
paths; do not publish `@gpuix`.

## Wave 3 consumption

Living marks (`src/blob.tsx` / `src/resting-motion.ts`) drive melt, lids, and
the selected plate through this vendored `motion-spring` module — not a
hand-rolled `setTimeout` clock. Public `@gpuix/react` re-exports `onFrame`,
`stepSpring`, and `GELATIN`. Lease helpers (`subscribeSpringTick`,
`stepSpringLease`, `px` vs `opacity` publish) live in `dist/motion-spring.js`
and share the MotionDiv / `startFrameLoop` listener set so PulseClock can
park. Frozen sisters still pass `markLifeSpringImmediate` and never lease.
Live marks also force-snap at 420ms (`stepMarkSpringLease`) so a 0↔1 lid
travel cannot sit outside gpuix's 0.08 opacity crawl window and hold the clock.

## Wave 3.1 mark-local px

gpuix `stepSpringLease` still rounds **all** px channels (`Math.round`) and
only publishes when the integer changes. Living melts are ±2–4px, so that
path paints ~2–3 frames and looks like a stair-step. Automaton does **not**
fork `motion-spring.js`. `stepMarkSpringLease` steps the same Euler / `onFrame`
lease, then:

- publishes left/top/width/height at **0.1px**
- skips gpuix's 280ms / 2.25px budget snap on px (that window *is* the melt)
- keeps opacity on the gpuix kind helpers
- still hard-parks at 420ms; frozen sisters still `immediate`

Stay vendored 0.6.1. Do not switch to npm 0.7.0 for a finer px quantize.

## Related

- Park inventory: [`docs/idle-cpu.md`](./idle-cpu.md)
- Living marks / spring leases: [`docs/marks.md`](./marks.md)
- Agent invariant: `AGENTS.md` (vendored pin + idle GPUI sleeps)
