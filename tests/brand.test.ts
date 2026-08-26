import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { prepareMacApp } from '../scripts/open-mac-app.ts'
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

  test('mac app stub execs in-bundle bun, not a PATH CLI', () => {
    const stub = readFileSync(join(import.meta.dir, '..', 'macos', 'stub.c'), 'utf8')
    expect(stub).toContain('src/main.tsx')
    expect(stub).toContain('execv(bun, args)')
    expect(stub).toContain('in-bundle bun')
    expect(stub).not.toContain('/opt/homebrew/bin/bun')
  })

  test('prepareMacApp writes a Mach-O stub and a bun copy inside the app', () => {
    if (process.platform !== 'darwin') return
    const { stub, bun } = prepareMacApp()
    const magic = readFileSync(stub).subarray(0, 4)
    const isMachO =
      magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
      magic.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
      magic.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    expect(isMachO).toBe(true)
    expect(existsSync(bun)).toBe(true)
    expect(bun.endsWith('/runtime')).toBe(true)
    expect(statSync(bun).size).toBeGreaterThan(1000)
  })
})
