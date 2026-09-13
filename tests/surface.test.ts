import { describe, expect, test } from 'bun:test'
import { parseSkin } from '../src/runtime/skin'
import {
  cardGlassBg,
  groupBoxRadius,
  groupBoxStyle,
  groupBoxWash,
  menuFill,
  surfaceNeedsOpaqueFill,
} from '../src/chrome/surface'
import { tokensFromSkin } from '../src/theme/resolve'
import { T } from '../src/tokens'
import { cardStyle, menuStyle } from '../src/ui'

describe('frosted group-box recipe', () => {
  test('one radius feeds border and wash; menus stay opaque', () => {
    const frost = tokensFromSkin(parseSkin({ windowMode: 'frosted' }))
    const solid = tokensFromSkin(parseSkin({ windowMode: 'solid' }))
    expect(frost.windowMode).toBe('frosted')
    expect(solid.windowMode).toBe('solid')
    const card = groupBoxStyle(frost, 'card')
    expect(card.borderRadius).toBe(groupBoxRadius(frost, 'card'))
    expect(card.borderRadius).toBe(frost.radius.panel)
    expect(card.backgroundColor).toBe(groupBoxWash(frost, 'card'))
    expect(card.backgroundColor).toBe(cardGlassBg(frost))
    expect(card.backgroundColor).not.toBe(menuFill(frost))
    const menu = groupBoxStyle(frost, 'menu')
    expect(menu.backgroundColor).toBe(frost.menu)
    expect(menu.backgroundColor).toBe(menuStyle(frost).backgroundColor)
    expect(surfaceNeedsOpaqueFill('menu')).toBe(true)
    expect(surfaceNeedsOpaqueFill('card')).toBe(false)
    expect(groupBoxStyle(solid, 'card').backgroundColor).toBe(solid.raised)
    expect(solid.raised.startsWith('#') && solid.raised.length === 7).toBe(true)
    expect(frost.raised.length).toBeGreaterThan(7)
    expect(cardStyle(frost).borderRadius).toBe(frost.radius.panel)
    expect(T.windowMode).toBe('frosted')
  })
})
