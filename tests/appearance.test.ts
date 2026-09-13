import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  accentForAppearance,
  contrastRatio,
  parseAppearance,
  relativeLuminance,
  LIGHT_CANVAS,
  LIGHT_RAISED,
  LIGHT_SIDEBAR,
  LIGHT_TEXT,
} from '../src/theme/appearance'
import { parseSkin, readSkin, writeSkin } from '../src/runtime/skin'
import { tokensFromSkin } from '../src/theme/resolve'
import { T } from '../src/theme/tokens'

describe('designed light appearance', () => {
  test('dark stays the default; junk appearance is dark', () => {
    expect(parseAppearance(undefined)).toBe('dark')
    expect(parseAppearance('nope')).toBe('dark')
    expect(parseAppearance('light')).toBe('light')
    expect(tokensFromSkin(parseSkin({})).appearance).toBe('dark')
    expect(T.appearance).toBe('dark')
    const home = join(tmpdir(), `automaton-appearance-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    writeSkin({ appearance: 'light' }, home)
    expect(readSkin(home).appearance).toBe('light')
    const raw = JSON.parse(readFileSync(join(home, 'skin.json'), 'utf8')) as { appearance?: string }
    expect(raw.appearance).toBe('light')
    rmSync(home, { recursive: true, force: true })
  })

  test('light solid reassigns roles instead of inverting graphite', () => {
    const dark = tokensFromSkin(parseSkin({ windowMode: 'solid' }))
    const light = tokensFromSkin(parseSkin({ appearance: 'light', windowMode: 'solid' }))
    expect(light.appearance).toBe('light')
    expect(light.canvas).toBe(LIGHT_CANVAS)
    expect(light.sidebar).toBe(LIGHT_SIDEBAR)
    expect(light.raised).toBe(LIGHT_RAISED)
    expect(light.composer).toBe(LIGHT_CANVAS)
    expect(light.text).toBe(LIGHT_TEXT)
    expect(relativeLuminance(light.sidebar)).toBeLessThan(relativeLuminance(light.canvas))
    expect(light.raised).not.toBe(LIGHT_CANVAS)
    expect(light.canvas).not.toBe(dark.canvas)
    expect(light.text).not.toBe('#0D0D0D')
    expect(light.sidebar).not.toBe('#000000F5')
    expect(contrastRatio(light.text, LIGHT_CANVAS)).toBeGreaterThan(10)
    expect(contrastRatio(light.text, LIGHT_CANVAS)).toBeLessThan(18)
  })

  test('Brand accent keeps hue and clears AA on the content plane', () => {
    expect(accentForAppearance(T.catalog.green, 'dark')).toBe(T.catalog.green)
    const washed = accentForAppearance('#D4D4D4', 'light')
    expect(contrastRatio(washed, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
    expect(washed).not.toBe('#D4D4D4')
    const light = tokensFromSkin(parseSkin({ appearance: 'light', brand: { accent: '#D4D4D4' } }))
    expect(contrastRatio(light.accent, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
    const violet = tokensFromSkin(parseSkin({ appearance: 'light', brand: { accent: T.catalog.violet } }))
    expect(contrastRatio(violet.accent, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
  })

  test('light frost keeps Brand tint as a veil; composer is a plate not a dent', () => {
    const light = tokensFromSkin(parseSkin({ appearance: 'light', windowMode: 'frosted', frostWash: 12 }))
    expect(light.canvas.startsWith('#101010')).toBe(true)
    expect(light.composer).toBe(LIGHT_CANVAS)
    expect(light.raised).toBe(LIGHT_RAISED)
    expect(light.menu).toBe(LIGHT_CANVAS)
    const paper = tokensFromSkin(
      parseSkin({ appearance: 'light', windowMode: 'frosted', brand: { tint: '#EBEBEB' } }),
    )
    expect(paper.canvas.startsWith('#EBEBEB')).toBe(true)
  })

  test('Staff extracts ToggleGroup / EmptyState / Sheet from live panes', () => {
    const app = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    expect(app).toContain('<Sheet')
    expect(app).toContain('<EmptyState')
    expect(app).not.toContain('function SlidePane(')
    const settings = readFileSync(join(import.meta.dir, '../src/settings.tsx'), 'utf8')
    expect(settings).toContain('ToggleGroup')
    expect(settings).toContain('EmptyState')
    const inspector = readFileSync(join(import.meta.dir, '../src/inspector.tsx'), 'utf8')
    expect(inspector).toContain('ToggleGroup')
  })
})
