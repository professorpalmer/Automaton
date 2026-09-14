import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  GELATIN,
  MARK_PX_PUBLISH_EPS,
  SETTLE_HARD_MS,
  SPRING_FRAME_MS,
  isSpringRest,
  markPxShouldPublish,
  pumpFrames,
  quantizeMarkPx,
  quantizeSpringValue,
  resetMarkSpringHoldForTests,
  resetSpringClockForTests,
  shouldSnapMarkSpring,
  shouldSnapSpring,
  snapSpring,
  springChannelKind,
  springClockBusy,
  springShouldPublish,
  stepMarkSpringLease,
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
    expect(src).toMatch(/stepMarkSpringLease/)
    expect(src).toMatch(/quantizeMarkPx/)
    expect(src).toMatch(/MARK_PX_PUBLISH_EPS/)
    expect(src).toMatch(/shouldSnapMarkSpring/)
    expect(src).toMatch(/subscribeSpringTick/)
    expect(src).toMatch(/onFrame/)
    expect(src).not.toMatch(/setTimeout\(/)
    expect(src).not.toMatch(/Math\.round\(value\)/)
    expect(MARK_PX_PUBLISH_EPS).toBe(0.1)
    resetMarkSpringHoldForTests()
    expect(blobClockShouldHold(springClockBusy())).toBe(false)
    expect(blobClockShouldHold(true)).toBe(true)
  })

  test('vendored MotionDiv forwards type:spring to the host motion prop', () => {
    const src = readFileSync(join(import.meta.dir, '../node_modules/@gpuix/react/dist/components/index.js'), 'utf8')
    expect(src).toMatch(/motion:\s*\{/)
    expect(src).toContain('transition')
    expect(src).not.toMatch(/stepSpringLease/)
    expect(src).not.toMatch(/subscribeSpringTick/)
    expect(src).not.toMatch(/setCurrent/)
  })

  test('mark life springs park immediately when the sister is frozen', () => {
    expect(markLifeSpringImmediate(false)).toBe(true)
    expect(markLifeSpringImmediate(true)).toBe(false)
    expect(SETTLE_HARD_MS).toBe(420)
    expect(GELATIN.stiffness).toBe(28)
    expect(GELATIN.damping).toBe(8)
    expect(GELATIN.mass).toBe(1.25)
  })

  test('gpuix px channels skip sub-pixel publishes; mark melt publishes 0.1px', () => {
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
    expect(quantizeMarkPx(38.14)).toBe(38.1)
    expect(quantizeMarkPx(38.16)).toBe(38.2)
    expect(markPxShouldPublish(38, 38.04)).toBe(false)
    expect(markPxShouldPublish(38, 38.1)).toBe(true)
    expect(shouldSnapMarkSpring({ pos: 0, vel: 0 }, -1, 0, 'px')).toBe(false)
    expect(shouldSnapSpring({ pos: 0, vel: 0 }, -1, 0, 'px')).toBe(true)
    expect(shouldSnapMarkSpring({ pos: -0.96, vel: 0.1 }, -1, 80, 'px')).toBe(true)
    expect(shouldSnapMarkSpring({ pos: 38.95, vel: 4.3 }, 40, 280, 'px')).toBe(false)
    expect(shouldSnapSpring({ pos: 38.95, vel: 4.3 }, 40, 280, 'px')).toBe(true)
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
    const tracks = { opacity: { pos: 0.05, vel: 0 } }
    let painted: { opacity?: number } = { opacity: 0.05 }
    let elapsedMs = 0
    const opacityPublishes: number[] = []
    const stop = subscribeSpringTick((dt) => {
      elapsedMs += dt * 1000
      const result = stepMarkSpringLease({
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
    expect(elapsedMs).toBeLessThanOrEqual(SETTLE_HARD_MS + SPRING_FRAME_MS)
    expect(opacityPublishes.length).toBeGreaterThan(1)
    expect(opacityPublishes.some((value) => value !== Math.round(value))).toBe(true)
    stop()
    resetSpringClockForTests()
  })

  test('hard-parks a full lid travel at SETTLE_HARD_MS so blinks cannot hold the clock', () => {
    resetSpringClockForTests()
    const tracks = { opacity: { pos: 1, vel: 0 } }
    let painted: { opacity?: number } = { opacity: 1 }
    let elapsedMs = 0
    const stop = subscribeSpringTick((dt) => {
      elapsedMs += dt * 1000
      const result = stepMarkSpringLease({
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
      return result.moving
    })
    for (let i = 0; i < 80; i += 1) {
      pumpFrames(SPRING_FRAME_MS / 1000, i * SPRING_FRAME_MS)
      if (!springClockBusy()) break
    }
    expect(isSpringRest(tracks.opacity, 0)).toBe(true)
    expect(springClockBusy()).toBe(false)
    expect(elapsedMs).toBeGreaterThanOrEqual(SETTLE_HARD_MS)
    expect(elapsedMs).toBeLessThanOrEqual(SETTLE_HARD_MS + SPRING_FRAME_MS)
    stop()
    resetSpringClockForTests()
  })

  test('soft-wide melt paints many subpixel intermediates, then parks by 420ms', () => {
    resetSpringClockForTests()
    const tracks = {
      left: { pos: 0, vel: 0 },
      top: { pos: 0, vel: 0 },
      width: { pos: 38, vel: 0 },
      height: { pos: 38, vel: 0 },
    }
    let painted: { left?: number; top?: number; width?: number; height?: number } = {
      left: 0,
      top: 0,
      width: 38,
      height: 38,
    }
    const widthPublishes: number[] = []
    const heightPublishes: number[] = []
    const leftPublishes: number[] = []
    const topPublishes: number[] = []
    let elapsedMs = 0
    const stop = subscribeSpringTick((dt) => {
      elapsedMs += dt * 1000
      const result = stepMarkSpringLease({
        tracks,
        target: { left: -1, top: 1, width: 40, height: 36 },
        painted,
        dt,
        elapsedMs,
        stiffness: GELATIN.stiffness,
        damping: GELATIN.damping,
        mass: GELATIN.mass,
      })
      painted = result.painted
      if (result.publish) {
        if (painted.width != null) widthPublishes.push(painted.width)
        if (painted.height != null) heightPublishes.push(painted.height)
        if (painted.left != null) leftPublishes.push(painted.left)
        if (painted.top != null) topPublishes.push(painted.top)
      }
      return result.moving
    })
    for (let i = 0; i < 80; i += 1) {
      pumpFrames(SPRING_FRAME_MS / 1000, i * SPRING_FRAME_MS)
      if (!springClockBusy()) break
    }
    const nonInt = (values: number[]) => values.filter((value) => value !== Math.round(value))
    expect(nonInt(widthPublishes).length).toBeGreaterThan(5)
    expect(nonInt(heightPublishes).length).toBeGreaterThan(5)
    expect(nonInt(leftPublishes).length).toBeGreaterThan(3)
    expect(nonInt(topPublishes).length).toBeGreaterThan(3)
    expect(widthPublishes.some((value) => value > 38 && value < 40)).toBe(true)
    expect(isSpringRest(tracks.width, 40)).toBe(true)
    expect(isSpringRest(tracks.height, 36)).toBe(true)
    expect(isSpringRest(tracks.left, -1)).toBe(true)
    expect(isSpringRest(tracks.top, 1)).toBe(true)
    expect(springClockBusy()).toBe(false)
    expect(elapsedMs).toBeLessThanOrEqual(SETTLE_HARD_MS + SPRING_FRAME_MS)
    stop()
    resetSpringClockForTests()
  })

  test('gpuix integer px lease stair-steps the same 2px melt', () => {
    const tracks = { width: { pos: 38, vel: 0 } }
    let painted: { width?: number } = { width: 38 }
    const publishes: number[] = []
    for (let i = 0; i < 80; i += 1) {
      const elapsedMs = (i + 1) * SPRING_FRAME_MS
      const result = stepSpringLease({
        tracks,
        target: { width: 40 },
        painted,
        dt: SPRING_FRAME_MS / 1000,
        elapsedMs,
        stiffness: GELATIN.stiffness,
        damping: GELATIN.damping,
        mass: GELATIN.mass,
      })
      painted = result.painted
      if (result.publish && painted.width != null) publishes.push(painted.width)
      if (!result.moving) break
    }
    expect(publishes.every((value) => value === Math.round(value))).toBe(true)
    expect(publishes.length).toBeLessThanOrEqual(4)
  })
})
