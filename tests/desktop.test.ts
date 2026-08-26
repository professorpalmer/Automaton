import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { boxChromeHostDir, clearBoxProfileLocks, desktopDir, ensureDesktop, teardownDesktop } from '../src/runtime/desktop'

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

  test('profile lock clear removes dangling Chromium singletons', () => {
    const home = join(tmpdir(), `automaton-desk-lock-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const dir = boxChromeHostDir('staff', home)
    mkdirSync(dir, { recursive: true })
    symlinkSync('missing-host-pid', join(dir, 'SingletonLock'))
    expect(() => lstatSync(join(dir, 'SingletonLock'))).not.toThrow()
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false)
    clearBoxProfileLocks('staff', home)
    expect(() => lstatSync(join(dir, 'SingletonLock'))).toThrow()
    rmSync(home, { recursive: true, force: true })
  })
})
