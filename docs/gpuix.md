# `@gpuix/react` vendor pin (P2.1 honesty)

Automaton stays on **vendored** `@gpuix/react` **0.6.1**
(`file:vendor/gpuix-react-0.6.1.tgz`). Package / Info.plist are **0.5.0**
(Wave 2 P0 band cut). Still vendored 0.6.1 — do not drop onto npm 0.7.0.

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

## Related

- Park inventory: [`docs/idle-cpu.md`](./idle-cpu.md)
- Living marks / spring leases: [`docs/marks.md`](./marks.md)
- Agent invariant: `AGENTS.md` (vendored pin + idle GPUI sleeps)
