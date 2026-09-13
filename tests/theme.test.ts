import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { parseSkin, readSkin, writeSkin } from '../src/runtime/skin'
import { DEFAULT_BRAND, parseBrand, radiiFromBrand } from '../src/theme/brand'
import { toChatTheme, toFieldTheme } from '../src/theme/adapters'
import { tokensFromSkin } from '../src/theme/resolve'
import { DEFAULT_TOKENS, T } from '../src/theme/tokens'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-theme-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('token environment', () => {
  test('default snapshot is frozen and skin replaces it', () => {
    expect(Object.isFrozen(T)).toBe(true)
    expect(Object.isFrozen(T.radius)).toBe(true)
    const before = T.canvas
    const solid = tokensFromSkin(parseSkin({ windowMode: 'solid' }))
    expect(solid.windowMode).toBe('solid')
    expect(solid.canvas).toBe('#141414')
    expect(solid).not.toBe(T)
    expect(T.canvas).toBe(before)
    try {
      ;(T as { canvas: string }).canvas = '#ff00ff'
    } catch {
      /* freeze may throw */
    }
    expect(T.canvas).toBe(before)
  })

  test('Brand tint/accent/radius persist and derive the radius set', () => {
    const home = tmpHome()
    writeSkin(
      {
        brand: { tint: '#000000', accent: T.catalog.violet, radius: 10 },
      },
      home,
    )
    const skin = readSkin(home)
    expect(skin.brand).toEqual({ tint: '#000000', accent: T.catalog.violet, radius: 10 })
    const tokens = tokensFromSkin(skin)
    expect(tokens.accent).toBe(T.catalog.violet)
    expect(tokens.canvas.startsWith('#000000')).toBe(true)
    expect(tokens.radius).toEqual(radiiFromBrand(skin.brand))
    expect(tokens.radius.control).toBe(10)
    expect(tokens.radius.button).toBe(14)
    expect(tokens.radius.panel).toBe(18)
    expect(tokens.radius.surface).toBe(22)
    expect(tokens.radius.bubble).toBe(12)
    expect(tokens.radius.md).toBe(tokens.radius.button)
    rmSync(home, { recursive: true, force: true })
  })

  test('junk Brand falls back; adapters read the snapshot', () => {
    expect(parseBrand({ tint: 'neon', accent: 3, radius: 'wide' })).toEqual(DEFAULT_BRAND)
    expect(parseBrand({ radius: 99 }).radius).toBe(16)
    expect(radiiFromBrand(DEFAULT_BRAND).sm).toBe(DEFAULT_TOKENS.radius.sm)
    const chat = toChatTheme(T)
    const field = toFieldTheme(T)
    expect(chat.accent).toBe(T.accent)
    expect(chat.caret).toBe(T.accent)
    expect(chat.border).toBe(T.clear)
    expect(field.textMuted).toBe(T.text)
    const branded = tokensFromSkin(parseSkin({ brand: { accent: T.catalog.green } }))
    expect(toChatTheme(branded).accent).toBe(T.catalog.green)
  })

  test('Settings and inspector paint from useChrome, not frozen CARD_STYLE', () => {
    const settings = readFileSync(join(import.meta.dir, '../src/settings.tsx'), 'utf8')
    const inspector = readFileSync(join(import.meta.dir, '../src/inspector.tsx'), 'utf8')
    expect(settings).toContain('useChrome')
    expect(settings).not.toContain('CARD_STYLE')
    expect(settings).not.toContain('FIELD_THEME')
    expect(inspector).toContain('useChrome')
    expect(inspector).toContain('fieldTheme')
    expect(inspector).not.toContain('FIELD_THEME')
    expect(inspector).not.toContain("from './tokens'")
  })

  test('skin.json stores brand next to rail/window', () => {
    const home = tmpHome()
    writeSkin({ railWidth: T.layout.sidebarMin, brand: { accent: '#1084FE' } }, home)
    const raw = JSON.parse(readFileSync(join(home, 'skin.json'), 'utf8')) as { brand?: { accent?: string } }
    expect(raw.brand?.accent).toBe('#1084FE')
    rmSync(home, { recursive: true, force: true })
  })
})
