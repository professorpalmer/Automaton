import { existsSync, statSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { occupancyAt, SEED_BAKES, framePath, MARK_FRAMES } from '../scripts/bake-marks'
import { join } from 'node:path'

const marksRoot = join(import.meta.dir, '../src/marks')

describe('baked seed marks', () => {
  test('HEAD / hex / tablet silhouettes are solid at the core and empty at a corner', () => {
    expect(occupancyAt('blob', 64, 64)).toBe(1)
    expect(occupancyAt('hex', 64, 64)).toBe(1)
    expect(occupancyAt('tablet', 64, 64)).toBe(1)
    expect(occupancyAt('blob', 2, 2)).toBe(0)
    expect(occupancyAt('hex', 2, 2)).toBe(0)
    expect(occupancyAt('tablet', 2, 2)).toBe(0)
    expect(occupancyAt('pebble', 64, 64)).toBe(1)
    expect(occupancyAt('squircle', 64, 64)).toBe(1)
    expect(occupancyAt('wedge', 64, 64)).toBe(1)
    expect(occupancyAt('teardrop', 64, 40)).toBe(1)
    expect(occupancyAt('cloud', 64, 64)).toBe(1)
    expect(occupancyAt('pebble', 2, 2)).toBe(0)
  })

  test('seed trio writes the five still poses', () => {
    for (const seed of SEED_BAKES) {
      for (const frame of MARK_FRAMES) {
        const path = framePath(marksRoot, seed.shape, seed.tint, frame)
        expect(existsSync(path)).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(400)
      }
    }
  })
})
