import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { desktopDir, ensureDesktop, teardownDesktop } from '../src/runtime/desktop'

describe('mouth desktop', () => {
  test('ensure then teardown is one folder per mouth on the shared computer', () => {
    const home = join(tmpdir(), `automaton-desk-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const dir = ensureDesktop('staff', home)
    expect(dir).toBe(desktopDir('staff', home))
    expect(existsSync(join(dir, 'browser'))).toBe(true)
    expect(existsSync(join(dir, 'box-chrome'))).toBe(true)
    teardownDesktop('staff', home)
    expect(existsSync(dir)).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})
