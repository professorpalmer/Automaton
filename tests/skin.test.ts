import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { catalogHex } from '../src/runtime/factory'
import {
  chromeFromSkin,
  clampFrostWash,
  clampRailWidth,
  parseSkin,
  parseWindowMode,
  railDragOrigin,
  railIsCompact,
  railWidthFromDrag,
  readSkin,
  writeSkin,
} from '../src/runtime/skin'
import { T } from '../src/tokens'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-skin-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('graphite skin', () => {
  test('rail width clamps and compact is icon-only', () => {
    expect(clampRailWidth(10)).toBe(T.layout.sidebarMin)
    expect(clampRailWidth(900)).toBe(T.layout.sidebarMax)
    expect(clampRailWidth(T.layout.sidebarWidth)).toBe(T.layout.sidebarWidth)
    expect(railIsCompact(T.layout.sidebarMin)).toBe(true)
    expect(railIsCompact(T.layout.sidebarWidth)).toBe(false)
    expect(railWidthFromDrag(252, 250, 330)).toBe(332)
    expect(railWidthFromDrag(252, 250, Number.NaN)).toBe(252)
    expect(railDragOrigin(252)).toBe(252 + T.layout.railHandle / 2)
  })

  test('parseSkin ignores junk and never deals black as a rail width', () => {
    expect(parseSkin({ railWidth: 'wide', accent: 'neon' })).toEqual({
      railWidth: T.layout.sidebarWidth,
      windowMode: 'frosted',
      frostWash: 12,
    })
    expect(parseSkin({ railWidth: 72, accent: 'violet' })).toEqual({
      railWidth: 72,
      windowMode: 'frosted',
      frostWash: 12,
    })
  })

  test('read and write persist rail width', () => {
    const home = tmpHome()
    expect(readSkin(home).railWidth).toBe(T.layout.sidebarWidth)
    writeSkin({ railWidth: 64 }, home)
    expect(readSkin(home)).toEqual({
      railWidth: 64,
      windowMode: 'frosted',
      frostWash: 12,
    })
    rmSync(home, { recursive: true, force: true })
  })

  test('broken skin.json falls back', () => {
    const home = tmpHome()
    writeFileSync(join(home, 'skin.json'), '{')
    expect(readSkin(home).railWidth).toBe(T.layout.sidebarWidth)
    rmSync(home, { recursive: true, force: true })
  })

  test('seed faces stay graphite for Staff and catalog neon for sisters', () => {
    expect(catalogHex('staff')).toBe(T.staff.face)
    expect(catalogHex('staff')).not.toBe(T.catalog.red)
    expect(catalogHex('kernel')).toBe(T.catalog.green)
    expect(catalogHex('research')).toBe(T.catalog.blue)
    expect(JSON.stringify(T)).not.toContain('#E2795B')
  })

  test('window mode and wash clamp, solid chrome is opaque', () => {
    expect(parseWindowMode('solid')).toBe('solid')
    expect(parseWindowMode('nope')).toBe('frosted')
    expect(clampFrostWash(-4)).toBe(0)
    expect(clampFrostWash(140)).toBe(100)
    expect(chromeFromSkin(parseSkin({ windowMode: 'solid' })).windowBackground).toBe('opaque')
    expect(chromeFromSkin(parseSkin({ frostWash: 12 })).canvas).toBe('#10101009')
    expect(chromeFromSkin(parseSkin({})).windowBackground).toBe('blurred')
  })
})
