# `@gpuix/react` vendor pin (P2.1 + Wave 3.2 honesty)

Automaton stays on **vendored** `@gpuix/react` **0.6.2**
(`file:vendor/gpuix-react-0.6.2.tgz`) plus a matched
`@gpuix/native` **0.6.2** (`file:vendor/gpuix-native-0.6.2.tgz`).
Package / Info.plist are **0.8.0** (Wave 3 living-mark gel checkpoint).

Do **not** drop onto npm `@gpuix/react@0.7.0` or `@gpuix/react@0.8.0`
(registry dist has no motion-spring / no native spring passthrough).

## Decision: stay vendored, matched react + native

| Fact | Detail |
| --- | --- |
| React pin | `package.json` → `"@gpuix/react": "file:vendor/gpuix-react-0.6.2.tgz"` |
| Native pin | `"@gpuix/native": "file:vendor/gpuix-native-0.6.2.tgz"` (override) |
| Why vendor | #34 park + Wave 3.2 native spring passthrough are not on npm |
| Upstream | [remorses/gpuix#34](https://github.com/remorses/gpuix/pull/34) is still **OPEN** |
| Publish | Cary does **not** own the `@gpuix` npm scope. Never ask for `NPM_TOKEN` |

**Do not** leave spring-to-native React against shipped `@gpuix/native@0.6.0`.
That binary only interpolates tweens; `type: "spring"` would degrade to a
default duration tween.

## Wave 3.2: springs hit native

Vendored MotionDiv used to hijack `transition.type === "spring"` onto a JS
`stepSpringLease` + `setCurrent` loop and **omit** the host `motion` prop.
Rail/pane tweens (`duration` / `ease`) already reached native `motion.rs` and
felt continuous. Marks did not.

0.6.2 MotionDiv always forwards `motion` (tween **and** spring) to the host.
Native `packages/native/src/motion.rs` integrates stiffness/damping/mass
during GPUI paint and hard-parks at **420ms** so the process can sleep.
Frozen sisters never mount a `motion.div` (static `div`).

JS `motion-spring` / `useRestingStyle` stays in the tarball for leftover
lease-park and tests. Living marks no longer paint through it.

## When to drop the vendor tarball

Only after **both**:

1. remorses merges [gpuix#34](https://github.com/remorses/gpuix/pull/34) **and** the native-passthrough fix, **and**
2. a park-bearing `@gpuix/react` + matching `@gpuix/native` (with spring integrator) are **published** to npm

Then: drop `file:vendor/gpuix-react-0.6.2.tgz` and the native tarball, pin the
real npm versions, re-verify idle CPU (`bun run sample:idle-cpu` /
[`docs/idle-cpu.md`](./idle-cpu.md)), and remove this honesty hold.

Until then: keep the vendored pair; do not publish `@gpuix`.

## Related

- Park inventory: [`docs/idle-cpu.md`](./idle-cpu.md)
- Living marks: [`docs/marks.md`](./marks.md)
- Agent invariant: `AGENTS.md` (vendored pin + idle GPUI sleeps)
