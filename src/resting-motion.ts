/**
 * Thin hook over vendored `@gpuix/react` motion-spring (Wave 3).
 *
 * Living marks no longer own a hand-rolled 8ms timer clock. Ticks run on the
 * GPUIX frame loop (`onFrame` / `pumpFrames` from `startFrameLoop`) so
 * PulseClock can park when leases empty.
 *
 * Public `@gpuix/react` only re-exports `onFrame`, `stepSpring`, and `GELATIN`.
 * The lease helpers MotionDiv already uses (`subscribeSpringTick`,
 * `stepSpringLease`, channel kinds) live in `dist/motion-spring.js` but are
 * not on the package export map. Import that same file — not a second copy —
 * so marks share the MotionDiv / startFrameLoop listener set.
 *
 * TODO: drop this shim if gpuix grows a public `useRestingStyle` / immediate park.
 */
import { useEffect, useRef, useState } from 'react'
import { GELATIN } from '@gpuix/react'
import {
  SETTLE_BUDGET_MS,
  SETTLE_HARD_MS,
  SPRING_KEYS,
  allSpringChannelsRest,
  animateSignature,
  isSpringRest,
  pumpFrames,
  quantizeSpringValue,
  resetSpringClockForTests,
  seedSpringTrack,
  shouldSnapSpring,
  snapSpring,
  springChannelKind,
  springClockBusy,
  springShouldPublish,
  stepSpring,
  stepSpringLease,
  subscribeSpringTick,
  type SpringChannelKind,
  type SpringKey,
  type SpringTrack,
} from '../node_modules/@gpuix/react/dist/motion-spring.js'
import { runningTests } from './runtime/test-env'

/** Documented cadence of gpuix `DEFAULT_FRAME_MS`. Do not replace that host loop. */
export const SPRING_FRAME_MS = 8

export type SpringParams = {
  type?: 'spring'
  stiffness: number
  damping: number
  mass: number
  velocity?: number
}

export type { SpringChannelKind, SpringKey, SpringTrack }

export {
  GELATIN,
  SETTLE_BUDGET_MS,
  SETTLE_HARD_MS,
  SPRING_KEYS,
  allSpringChannelsRest,
  animateSignature,
  isSpringRest,
  pumpFrames,
  quantizeSpringValue,
  resetSpringClockForTests,
  seedSpringTrack,
  shouldSnapSpring,
  snapSpring,
  springChannelKind,
  springClockBusy,
  springShouldPublish,
  stepSpring,
  stepSpringLease,
  subscribeSpringTick,
}

/**
 * gpuix lease step plus Automaton's 420ms hard park.
 * Opacity 0↔1 (lids / plate) can sit outside gpuix's 0.08 crawl window;
 * force-snap so a blink cannot hold the PulseClock past SETTLE_HARD_MS.
 */
export function stepMarkSpringLease(
  opts: Parameters<typeof stepSpringLease>[0],
): ReturnType<typeof stepSpringLease> {
  const result = stepSpringLease(opts)
  if (!result.moving || opts.elapsedMs < SETTLE_HARD_MS) return result
  const painted: Partial<Record<SpringKey, number>> = { ...result.painted }
  let publish = result.publish
  for (const key of SPRING_KEYS) {
    const to = opts.target[key]
    if (to == null) continue
    opts.tracks[key] = snapSpring(to)
    if (painted[key] !== to) {
      painted[key] = to
      publish = true
    }
  }
  return { painted, moving: false, publish }
}

/**
 * Spring-drive numeric style channels on the gpuix lease.
 * `px` keys publish integer pixels; `opacity` keeps subpixel publishes
 * (`springChannelKind` / `stepSpringLease`). Unsubscribes `onFrame` when
 * every channel is at rest so GPUI can sleep.
 * Mark life (melt / lids / plate) must pass `immediate: true` when the sister
 * is frozen so idle rails never lease this clock (see docs/marks.md).
 */
export function useRestingStyle<T extends Partial<Record<SpringKey, number>>>(
  targets: T,
  spring: SpringParams,
  opts?: { immediate?: boolean },
): T {
  const immediate = opts?.immediate === true || runningTests()
  const signature = animateSignature(targets)
  const [painted, setPainted] = useState<T>(targets)
  const tracksRef = useRef<Partial<Record<SpringKey, SpringTrack>>>({})
  const paintedRef = useRef<Partial<Record<SpringKey, number>>>(targets)
  const targetsRef = useRef(targets)
  targetsRef.current = targets

  useEffect(() => {
    const next = targetsRef.current
    if (immediate) {
      const snapped: Partial<Record<SpringKey, number>> = {}
      const tracks: Partial<Record<SpringKey, SpringTrack>> = {}
      for (const key of SPRING_KEYS) {
        const value = next[key]
        if (value == null) continue
        snapped[key] = value
        tracks[key] = snapSpring(value)
      }
      tracksRef.current = tracks
      paintedRef.current = snapped
      setPainted(snapped as T)
      return
    }
    for (const key of SPRING_KEYS) {
      const to = next[key]
      if (to == null) continue
      seedSpringTrack(tracksRef.current, key, paintedRef.current[key], to, spring.velocity ?? 0)
    }
    if (allSpringChannelsRest(tracksRef.current, next)) return
    let elapsedMs = 0
    return subscribeSpringTick((dt) => {
      elapsedMs += dt * 1000
      const result = stepMarkSpringLease({
        tracks: tracksRef.current,
        target: targetsRef.current,
        painted: paintedRef.current,
        dt,
        elapsedMs,
        stiffness: spring.stiffness,
        damping: spring.damping,
        mass: spring.mass,
        kick: spring.velocity ?? 0,
      })
      if (result.publish) {
        paintedRef.current = result.painted
        setPainted(result.painted as T)
      }
      return result.moving
    })
  }, [signature, immediate, spring.stiffness, spring.damping, spring.mass, spring.velocity])

  return immediate ? targets : painted
}
