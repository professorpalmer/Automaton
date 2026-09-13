import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  GELATIN,
  SETTLE_HARD_MS,
  SPRING_FRAME_MS,
  isSpringRest,
  pumpFrames,
  quantizeSpringValue,
  resetSpringClockForTests,
  shouldSnapSpring,
  snapSpring,
  springChannelKind,
  springClockBusy,
  springShouldPublish,
  stepSpring,
  stepSpringLease,
  subscribeSpringTick,
} from '../src/resting-motion'
import { blobClockShouldHold, markLifeSpringImmediate } from '../src/blob'
import { T } from '../src/tokens'

const EYE = { stiffness: 13, damping: 14, mass: 1 }

describe('gpuix motion-spring lease', () => {
  test('frame cadence matches gpuix DEFAULT_FRAME_MS and does not replace it', () => {
    const src = readFileSync(join(import.meta.dir, '../src/resting-motion.ts'), 'utf8')
    expect(SPRING_FRAME_MS).toBe(8)
    expect(src).toMatch(/motion-spring/)
    expect(src).toMatch(/stepSpringLease/)
    expect(src).toMatch(/subscribeSpringTick/)
    expect(src).toMatch(/onFrame/)
    expect(src).not.toMatch(/setTimeout/)
    expect(src).not.toMatch(/Math\.round\(value\)/)
    expect(blobClockShouldHold(springClockBusy())).toBe(false)
    expect(blobClockShouldHold(true)).toBe(true)
  })

  test('mark life springs park immediately when the sister is frozen', () => {
    expect(markLifeSpringImmediate(false)).toBe(true)
    expect(markLifeSpringImmediate(true)).toBe(false)
    expect(SETTLE_HARD_MS).toBe(420)
    expect(GELATIN.stiffness).toBe(28)
    expect(GELATIN.damping).toBe(8)
    expect(GELATIN.mass).toBe(1.25)
  })

  test('px channels skip sub-pixel publishes; opacity keeps finer steps', () => {
    expect(springChannelKind('left')).toBe('px')
    expect(springChannelKind('width')).toBe('px')
    expect(springChannelKind('opacity')).toBe('opacity')
    expect(springShouldPublish(12, 12, 'px')).toBe(false)
    expect(springShouldPublish(12, 12.4, 'px')).toBe(false)
    expect(springShouldPublish(12, 12.6, 'px')).toBe(true)
    expect(quantizeSpringValue(12.4, 'px')).toBe(12)
    expect(quantizeSpringValue(12.6, 'px')).toBe(13)
    expect(springShouldPublish(0.4, 0.401, 'opacity')).toBe(false)
    expect(springShouldPublish(0.4, 0.403, 'opacity')).toBe(true)
    expect(quantizeSpringValue(0.403, 'opacity')).toBe(0.403)
  })

  test('snaps when |v| is small and the channel is inside a pixel', () => {
    expect(shouldSnapSpring({ pos: 10.3, vel: 0.02 }, 10)).toBe(true)
    expect(shouldSnapSpring({ pos: 18, vel: 2.4 }, 10)).toBe(false)
    expect(snapSpring(10)).toEqual({ pos: 10, vel: 0 })
    expect(isSpringRest(snapSpring(10), 10)).toBe(true)
  })

  test('soft gelatin and eye springs rest after a snap, not forever', () => {
    let body = { pos: 0, vel: 0 }
    let eye = { pos: 0, vel: 0 }
    const dt = SPRING_FRAME_MS / 1000
    for (let i = 0; i < 80; i += 1) {
      const elapsed = (i + 1) * SPRING_FRAME_MS
      body = stepSpring(body, 8, dt, GELATIN.stiffness, GELATIN.damping, GELATIN.mass)
      eye = stepSpring(eye, 4, dt, EYE.stiffness, EYE.damping, EYE.mass)
      if (shouldSnapSpring(body, 8, elapsed, 'px')) body = snapSpring(8)
      if (shouldSnapSpring(eye, 4, elapsed, 'px')) eye = snapSpring(4)
    }
    expect(SETTLE_HARD_MS).toBeLessThan(T.blob.wanderMs * 0.55)
    expect(isSpringRest(body, 8)).toBe(true)
    expect(isSpringRest(eye, 4)).toBe(true)
  })

  test('unsubscribes onFrame when every channel is at rest', () => {
    resetSpringClockForTests()
    expect(springClockBusy()).toBe(false)
    const tracks = { opacity: { pos: 0.4, vel: 0.25 } }
    let painted: { opacity?: number } = { opacity: 0.4 }
    let elapsedMs = 0
    const opacityPublishes: number[] = []
    const stop = subscribeSpringTick((dt) => {
      elapsedMs += dt * 1000
      const result = stepSpringLease({
        tracks,
        target: { opacity: 0 },
        painted,
        dt,
        elapsedMs,
        stiffness: EYE.stiffness,
        damping: EYE.damping,
        mass: EYE.mass,
      })
      painted = result.painted
      if (result.publish && painted.opacity != null) opacityPublishes.push(painted.opacity)
      return result.moving
    })
    expect(springClockBusy()).toBe(true)
    for (let i = 0; i < 80; i += 1) {
      pumpFrames(SPRING_FRAME_MS / 1000, i * SPRING_FRAME_MS)
      if (!springClockBusy()) break
    }
    expect(isSpringRest(tracks.opacity, 0)).toBe(true)
    expect(springClockBusy()).toBe(false)
    expect(opacityPublishes.length).toBeGreaterThan(1)
    expect(opacityPublishes.some((value) => value !== Math.round(value))).toBe(true)
    stop()
    resetSpringClockForTests()
  })
})
