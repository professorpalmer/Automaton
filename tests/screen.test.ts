import { describe, expect, test } from 'bun:test'
import { BOX_NAME } from '../src/runtime/computer'
import { ensureScreen, screenBootArgv } from '../src/runtime/screen'

describe('box screen', () => {
  test('boot argv is automaton-screen on the shared box', () => {
    expect(screenBootArgv(1)).toEqual(['automaton-screen', '1'])
    expect(screenBootArgv(4)[0]).toBe('automaton-screen')
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
