/**
 * JS motion-spring lease helpers (Wave 3 / 3.1 leftover).
 *
 * Wave 3.2 living marks drive melt / lids / plate through `motion.div` →
 * native `motion.rs`. This module stays for tests and any leftover JS
 * `useRestingStyle` consumer. Frozen sisters never call it (sister-freeze
 * uses a static div). Lease-park still matters if something else subscribes
 * `onFrame` — PulseClock parks when the listener set is empty.
 *
 * Public `@gpuix/react` re-exports `onFrame`, `stepSpring`, and `GELATIN`.
 * Lease helpers live in `dist/motion-spring.js`.
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
 * Soft-wide / soft-tall are only ±2–4px. gpuix `stepSpringLease` rounds every
 * px channel and publishes only when the integer changes — ~2–3 paints for the
 * whole melt. Marks publish at 0.1px so the same travel looks like gel.
 */
export const MARK_PX_PUBLISH_EPS = 0.1

/** gpuix `stepSpring` rest for px (not exported from motion-spring). */
const MARK_PX_REST = 0.05
/** gpuix SNAP_POS_OPACITY — same rest MotionDiv uses for lids / plate. */
const MARK_OPACITY_REST = 0.002

export function quantizeMarkPx(value: number): number {
  return Number(value.toFixed(1))
}

export function markPxShouldPublish(previous: number, next: number): boolean {
  return quantizeMarkPx(previous) !== quantizeMarkPx(next)
}

/**
 * gpuix px near-snap is 1.05px. Soft-wide left/top only travel 1px, so that
 * window fires on the first frame and the box pops. Marks near-snap only the
 * last 0.1px of leftover crawl. Skip the 280ms / 2.25px budget snap too —
 * that window is the entire melt. Hard park stays at SETTLE_HARD_MS.
 */
export function shouldSnapMarkSpring(
  track: SpringTrack,
  target: number,
  elapsedMs: number,
  kind: SpringChannelKind = 'px',
): boolean {
  if (kind === 'opacity') return shouldSnapSpring(track, target, elapsedMs, 'opacity')
  const dist = Math.abs(track.pos - target)
  const speed = Math.abs(track.vel)
  return speed < 0.35 && dist < MARK_PX_PUBLISH_EPS
}

/**
 * Mark-local lease: gpuix Euler + onFrame, 0.1px melt publishes, 420ms park.
 * Do not call `stepSpringLease` for left/top/width/height — its integer
 * quantize and 280ms budget snap are the stair-step. Opacity still uses the
 * gpuix kind helpers. Frozen sisters never reach this (immediate park).
 */
export function stepMarkSpringLease(
  opts: Parameters<typeof stepSpringLease>[0],
): ReturnType<typeof stepSpringLease> {
  const { tracks, target, dt, elapsedMs, stiffness, damping, mass, kick = 0 } = opts
  let moving = false
  let publish = false
  const painted: Partial<Record<SpringKey, number>> = { ...opts.painted }
  for (const key of SPRING_KEYS) {
    const to = target[key]
    if (to == null) continue
    const kind = springChannelKind(key)
    const rest = kind === 'opacity' ? MARK_OPACITY_REST : MARK_PX_REST
    let track = seedSpringTrack(tracks, key, painted[key], to, kick)
    track = stepSpring(track, to, dt, stiffness, damping, mass, rest)
    if (shouldSnapMarkSpring(track, to, elapsedMs, kind)) track = snapSpring(to)
    tracks[key] = track
    if (!isSpringRest(track, to)) moving = true
    const visual = isSpringRest(track, to)
      ? to
      : kind === 'opacity'
        ? quantizeSpringValue(track.pos, 'opacity')
        : quantizeMarkPx(track.pos)
    const previous = painted[key]
    const changed =
      previous == null ||
      (kind === 'opacity' ? springShouldPublish(previous, visual, 'opacity') : markPxShouldPublish(previous, visual))
    if (changed && previous !== visual) {
      painted[key] = visual
      publish = true
    }
  }
  if (!moving || elapsedMs < SETTLE_HARD_MS) return { painted, moving, publish }
  for (const key of SPRING_KEYS) {
    const to = target[key]
    if (to == null) continue
    tracks[key] = snapSpring(to)
    if (painted[key] !== to) {
      painted[key] = to
      publish = true
    }
  }
  return { painted, moving: false, publish }
}

/**
 * Spring-drive numeric style channels on the gpuix onFrame lease.
 * Mark px (left/top/width/height) publishes at 0.1px; opacity keeps gpuix
 * subpixel steps. Unsubscribes `onFrame` when every channel is at rest so
 * GPUI can sleep. Mark life must pass `immediate: true` when the sister is
 * frozen so idle rails never lease this clock (see docs/marks.md).
 */

/** Native mark springs do not arm `springClockBusy`. Hold look/pose this long after a kick. */
export const MARK_SPRING_HOLD_MS = 780

let markSpringHoldUntil = 0

export function noteMarkSpringKick(holdMs = MARK_SPRING_HOLD_MS): void {
  markSpringHoldUntil = Math.max(markSpringHoldUntil, Date.now() + holdMs)
}

export function markSpringHoldBusy(): boolean {
  return Date.now() < markSpringHoldUntil
}

export function resetMarkSpringHoldForTests(): void {
  markSpringHoldUntil = 0
}

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
