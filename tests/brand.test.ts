import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { MARK_PATH, PRODUCT, markSvg } from '../src/brand'
import { T } from '../src/tokens'

describe('product brand', () => {
  test('product name is Automaton and the mark files exist', () => {
    expect(PRODUCT).toBe('Automaton')
    expect(T.brand.yellow).toBe('#F0C000')
    expect(T.brand.mark).toBe(20)
    expect(markSvg()).toContain('circle')
    expect(markSvg()).toContain(T.inverse)
    expect(existsSync(MARK_PATH)).toBe(true)
    expect(statSync(MARK_PATH).size).toBeGreaterThan(100)
    expect(existsSync(join(import.meta.dir, '..', 'brand', 'app-icon.png'))).toBe(true)
    expect(existsSync(join(import.meta.dir, '..', 'macos', 'Automaton.app', 'Contents', 'Resources', 'AppIcon.icns'))).toBe(
      true,
    )
  })
})
