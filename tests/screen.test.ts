import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { BOX_NAME } from '../src/runtime/computer'
import { boxChromeAlive, ensureScreen, screenBootArgv } from '../src/runtime/screen'

describe('box screen', () => {
  test('screen boot does not start a WM frame over Chrome', () => {
    const sh = readFileSync(join(import.meta.dir, '../box/screen.sh'), 'utf8')
    expect(sh).not.toContain('fluxbox >/tmp')
    expect(sh).toContain('xsetroot')
    const ts = readFileSync(join(import.meta.dir, '../src/runtime/screen.ts'), 'utf8')
    expect(ts).not.toContain('fluxbox >/tmp')
  })

  test('boot argv is automaton-screen on the shared box', () => {
    expect(screenBootArgv(1)).toEqual(['automaton-screen', '1'])
    expect(screenBootArgv(4)[0]).toBe('automaton-screen')
  })

  test('boxChromeAlive treats only a live process as up', () => {
    const calls: string[][] = []
    const docker = (args: string[]) => {
      calls.push(args)
      if (args[0] === 'exec') {
        const cmd = args.join(' ')
        expect(cmd).toContain('NEEDLE=user-data-dir=')
        expect(cmd).toContain('CHROME_BIN=')
        expect(cmd).toContain('$2 !~ /^Z/')
        expect(cmd).toContain('$0 !~ /awk/')
        const script = args.at(-1) ?? ''
        expect(script).not.toContain('box-chrome')
        expect(script).not.toContain('/usr/lib/chromium/chromium')
        return { status: 1, text: '' }
      }
      return { status: 1, text: args.join(' ') }
    }
    expect(boxChromeAlive('staff', '/tmp/automaton-screen-alive', { docker })).toBe(false)
    expect(calls.some((args) => args[0] === 'exec')).toBe(true)
  })

  test('ensureScreen is a no-op when the box is down', () => {
    const docker = (args: string[]) => {
      if (args[0] === 'inspect') return { status: 0, text: 'false\n' }
      return { status: 1, text: args.join(' ') }
    }
    expect(ensureScreen('staff', '/tmp/automaton-screen-test', { docker })).toBe(false)
    expect(BOX_NAME).toBe('automaton-computer')
  })
})
