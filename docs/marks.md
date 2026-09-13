# Living marks (P1.7)

Rail marks are Automaton art (`SisterBlob` + baked `src/marks/` frames), not
Grok/Hermes assets. Package is **0.7.0** (Wave 2 P2 band cut).

## What improved

| Cue | Behavior |
| --- | --- |
| Glance | Selected Staff uses `selectedGlance` + lively wander/blink; idle sisters stay frozen (`alive = selected \|\| working`) |
| Weight / squash | Soft `restMelt` → `poseLayout` on alive-at-rest marks; gpuix `GELATIN` + mark-local `stepMarkSpringLease` (0.1px melt publish) via `useRestingStyle` |
| Lid life | Blink closes lids with height + opacity spring (`EYE_SPRING`), not a hard cut |
| Selected lift | `T.blob.selectedLift` on the melt box while selected (no pointer drag) |
| Park | `markLifeSpringImmediate` so frozen sisters never lease the spring clock; live springs hard-snap at 420ms |

Working mouths still squash via `workPose` SVG stamps (`wide` / `tall`). Soft melt
is for selected rest life — not a second layout physics on the feed.

## Still stubby (honest)

- No full gelatin body sim; soft-wide / soft-tall are still small pixel melts (±2–4px). Wave 3.1 publishes those at 0.1px so the travel is gel, not 2–3 integer stairs.
- Neighbor (non-selected) glances only run when that sister is `alive` (working);
  cold sisters are intentional still frames.
- Enter stagger exists in `presentBlob` but the rail does not tween enter size yet.
- Pointer smear trails are drag-only; not idle life.
- Idle CPU band is still the P1.6 proof in [`docs/idle-cpu.md`](./idle-cpu.md) —
  do not claim perfect 0% or “perfect life.”

## Do not

- Add another animation library.
- Put Motion `layout` / `layoutScroll` / `popLayout` on virtual feed rows or the live tail.
- Rip Grok shapes/colors or invent two-lobe / scrotum silhouettes.
- Publish `@gpuix`; park primitives stay Automaton-side or vendored `file:vendor` ([`docs/gpuix.md`](./gpuix.md) — stay vendored until park publishes).

## Parks

Mark springs share the same lease-park as MotionDiv / StickSpring:

- `spring-lease` — `src/resting-motion.ts` (mark-local 0.1px melt publish, 0.1px leftover snap, 420ms hard park) + vendored `@gpuix/react` `motion-spring` (`onFrame` / Euler). Frozen sisters never lease.
- `sister-freeze` — `src/blob.tsx` + `alive` from `src/app.tsx`

Inventory: `idleParkInventory()` in `src/runtime/idle-health.ts`. Re-verify CPU with
[`docs/idle-cpu.md`](./idle-cpu.md).
