import { describe, expect, test } from 'bun:test'
import { boxShellArgv, boxShellSpoken } from '../src/runtime/box-shell'

describe('box shell verb', () => {
  test('PATH check is command -v; apt install is root docker exec argv', () => {
    expect(boxShellArgv({ kind: 'which', name: 'claude' }).argv).toEqual([
      'sh',
      '-c',
      'command -v "$1"',
      'box-which',
      'claude',
    ])
    const install = boxShellArgv({ kind: 'install', name: 'curl' })
    expect(install.user).toBe('root')
    expect(install.argv.at(-1)).toBe('curl')
    expect(install.argv.join(' ')).toContain('apt-get install')
  })

  test('spoken lines name the computer, not job ids', () => {
    expect(
      boxShellSpoken({ kind: 'which', name: 'claude' }, { status: 0, text: '/usr/bin/claude\n' }),
    ).toEqual({ ok: true, spoken: 'claude is on the computer at /usr/bin/claude.' })
    expect(boxShellSpoken({ kind: 'which', name: 'claude' }, { status: 1, text: '' })).toEqual({
      ok: true,
      spoken: 'claude is not on PATH on the computer.',
    })
    expect(boxShellSpoken({ kind: 'install', name: 'curl' }, { status: 0, text: '' })).toEqual({
      ok: true,
      spoken: 'Installed curl on the computer.',
    })
  })
})
