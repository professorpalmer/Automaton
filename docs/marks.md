# Living marks (Wave 3.2)

Rail marks are Automaton art (`SisterBlob` + baked `src/marks/` frames), not
Grok/Hermes assets. Package is **0.16.0** (Wave 3 living-mark gel checkpoint).

Rolled back to first native gel (pre-3.2.1): full GELATIN, no mark-spring look hold, native hard-park 420ms, soft-wide/tall ±2px.

## What improved

| Cue | Behavior |
| --- | --- |
| Glance | Selected Staff uses `selectedGlance` + lively wander/blink; idle sisters stay frozen (`alive = selected \|\| working`) |
| Weight / squash | Soft `restMelt` → `poseLayout` on alive-at-rest marks; `SpringBox` + `motion.div` / `BODY_SPRING` (`GELATIN`) hits native `motion.rs` |
| Lid life | Blink closes lids with height + opacity + top on `EYE_SPRING` (native), not a hard cut and not a JS setState loop |
| Selected plate | Opacity springs on `BODY_SPRING` while selected; unselected / drag is static |
| Park | `markLifeSpringImmediate` → static `div` (no host motion track). Live native springs hard-park at 420ms |

Working mouths still squash via `workPose` SVG stamps (`wide` / `tall`). Soft melt
is for selected rest life — not a second layout physics on the feed.

Wave 3.2.3 lively eye wander (~1.15–1.7×) reverted — felt choppy; back to 0.55–0.9×.

Wave 3.2.2: soft-wide/tall melt ±1px (was ±2px) so glance does not pop size.

Wave 3.2.1 feel: slower `BODY_SPRING` (GELATIN×0.64 / +damping / +mass), look/pose hold while native melt settles (~780ms), native hard-park 850ms, soft melt targets at 0.1px.

## Still stubby (honest)

- No full gelatin body sim; soft-wide / soft-tall are still small pixel melts (±2–4px). Wave 3.2 paints those continuously on the GPU/GPUI frame, not as 0.1px JS publishes.
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
- Publish `@gpuix`; stay on the matched vendored react + native pair ([`docs/gpuix.md`](./gpuix.md)).

## Parks

- `spring-lease` — native `motion.rs` settle / 420ms hard park on living `motion.div`. JS `src/resting-motion.ts` lease remains for leftover / tests. Frozen sisters never lease or mount a spring track.
- `sister-freeze` — `src/blob.tsx` + `alive` from `src/app.tsx`

Inventory: `idleParkInventory()` in `src/runtime/idle-health.ts`. Re-verify CPU with
[`docs/idle-cpu.md`](./idle-cpu.md).
