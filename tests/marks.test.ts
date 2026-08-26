import { existsSync, statSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { occupancyAt, SEED_BAKES, framePath, MARK_FRAMES, bakeFrame, blackInkCentroid, BAKE_SIZE } from '../scripts/bake-marks'
import { join } from 'node:path'
import { T } from '../src/tokens'

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
    expect(occupancyAt('bean', 64, 64)).toBe(1)
    expect(occupancyAt('egg', 64, 64)).toBe(1)
    expect(occupancyAt('capsule', 64, 64)).toBe(1)
    expect(occupancyAt('cylinder', 64, 64)).toBe(1)
    expect(occupancyAt('gem', 64, 64)).toBe(1)
    expect(occupancyAt('crystal', 64, 64)).toBe(1)
    expect(occupancyAt('shield', 64, 64)).toBe(1)
    expect(occupancyAt('dome', 64, 40)).toBe(1)
    expect(occupancyAt('arch', 64, 48)).toBe(1)
    expect(occupancyAt('leaf', 64, 64)).toBe(1)
  })

  test('catalog fill stays neon and body is eyeless', () => {
    const rest = bakeFrame('pebble', T.catalog.orange, 'rest')
    const core = (64 * BAKE_SIZE + 64) * 4
    expect(rest[core]).toBeGreaterThan(200)
    expect(rest[core + 1]).toBeLessThan(150)
    expect(rest[core + 2]).toBeLessThan(50)
    const eyes = blackInkCentroid(rest, BAKE_SIZE)
    expect(eyes.n).toBeGreaterThan(20)
    const mid = (Math.round(eyes.y) * BAKE_SIZE + Math.round(eyes.x)) * 4
    expect(rest[mid] + rest[mid + 1] + rest[mid + 2]).toBeGreaterThan(36)
    const body = blackInkCentroid(bakeFrame('pebble', T.catalog.orange, 'body'), BAKE_SIZE)
    expect(body.n).toBeLessThan(8)
    const cloudEyes = blackInkCentroid(bakeFrame('cloud', T.catalog.cyan, 'rest'), BAKE_SIZE)
    expect(cloudEyes.n).toBeGreaterThan(20)
  })

  test('seed trio writes rest, breathe, selected, and body', () => {
    for (const seed of SEED_BAKES) {
      for (const frame of MARK_FRAMES) {
        const path = framePath(marksRoot, seed.shape, seed.tint, frame)
        expect(existsSync(path)).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(400)
      }
    }
  })
})
