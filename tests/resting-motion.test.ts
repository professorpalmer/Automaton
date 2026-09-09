import { describe, expect, test } from 'bun:test'
import {
  isSpringRest,
  quantizeSpringValue,
  resetSpringClockForTests,
  SETTLE_HARD_MS,
  shouldSnapSpring,
  snapSpring,
  SPRING_FRAME_MS,
  springClockBusy,
  springShouldPublish,
  stepSpringChannel,
  subscribeSpringTick,
} from '../src/resting-motion'
import { T } from '../src/tokens'

const SOFT = { type: 'spring' as const, stiffness: 28, damping: 8, mass: 1.25 }
const EYE = { type: 'spring' as const, stiffness: 13, damping: 14, mass: 1 }

describe('resting spring clock', () => {
  test('frame cadence matches gpuix DEFAULT_FRAME_MS and does not replace it', () => {
    expect(SPRING_FRAME_MS).toBe(8)
  })

  test('skips no-op and sub-pixel publishes', () => {
    expect(springShouldPublish(12, 12)).toBe(false)
    expect(springShouldPublish(12, 12.4)).toBe(false)
    expect(springShouldPublish(12, 12.6)).toBe(true)
    expect(quantizeSpringValue(12.4)).toBe(12)
    expect(quantizeSpringValue(12.6)).toBe(13)
  })

  test('snaps when |v| is small and the channel is inside a pixel', () => {
    expect(shouldSnapSpring({ value: 10.3, velocity: 0.02 }, 10)).toBe(true)
    expect(shouldSnapSpring({ value: 18, velocity: 2.4 }, 10)).toBe(false)
    expect(snapSpring(10)).toEqual({ value: 10, velocity: 0 })
    expect(isSpringRest(snapSpring(10), 10)).toBe(true)
  })

  test('soft gelatin and eye springs rest after a snap, not forever', () => {
    let body = { value: 0, velocity: 0 }
    let eye = { value: 0, velocity: 0 }
    for (let i = 0; i < 80; i += 1) {
      const elapsed = (i + 1) * SPRING_FRAME_MS
      body = stepSpringChannel(body, 8, SOFT, SPRING_FRAME_MS)
      eye = stepSpringChannel(eye, 4, EYE, SPRING_FRAME_MS)
      if (shouldSnapSpring(body, 8, elapsed)) body = snapSpring(8)
      if (shouldSnapSpring(eye, 4, elapsed)) eye = snapSpring(4)
    }
    expect(SETTLE_HARD_MS).toBeLessThan(T.blob.wanderMs * 0.55)
    expect(isSpringRest(body, 8)).toBe(true)
    expect(isSpringRest(eye, 4)).toBe(true)
  })

  test('unsubscribes the 8ms tick when every channel is at rest', async () => {
    resetSpringClockForTests()
    expect(springClockBusy()).toBe(false)
    let value = 0.4
    let velocity = 0.25
    const publishes: number[] = []
    const stop = subscribeSpringTick((dtMs) => {
      const stepped = stepSpringChannel({ value, velocity }, 0, EYE, dtMs)
      value = stepped.value
      velocity = stepped.velocity
      if (shouldSnapSpring({ value, velocity }, 0)) {
        value = 0
        velocity = 0
      }
      if (springShouldPublish(publishes[publishes.length - 1] ?? 99, value)) {
        publishes.push(quantizeSpringValue(value))
      }
      return !isSpringRest({ value, velocity }, 0)
    })
    expect(springClockBusy()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(isSpringRest({ value, velocity }, 0)).toBe(true)
    expect(springClockBusy()).toBe(false)
    expect(publishes.length).toBeLessThan(20)
    stop()
    resetSpringClockForTests()
  })
})
