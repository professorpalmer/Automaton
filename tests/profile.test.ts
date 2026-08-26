import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  ensureSeedProfiles,
  kitForAgent,
  parseProfile,
  readProfile,
  writeProfile,
} from '../src/runtime/profile'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-profile-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('agent profiles', () => {
  test('seed profiles land on disk with kit and graphite marks', () => {
    const home = tmpHome()
    ensureSeedProfiles(home)
    const staff = readProfile('staff', home)
    expect(staff?.kit).toBe('coordinator')
    expect(staff?.avatarShape).toBe('blob')
    expect(kitForAgent('kernel', home)).toBe('code')
    expect(kitForAgent('research', home)).toBe('lookup')
    rmSync(home, { recursive: true, force: true })
  })

  test('parseProfile fills blanks and never invents a kit', () => {
    const parsed = parseProfile({ name: 'Scout' }, 'agent_9')
    expect(parsed.id).toBe('agent_9')
    expect(parsed.name).toBe('Scout')
    expect(parsed.kit).toBe('blank')
    expect(parsed.namedBy).toBe('app')
  })

  test('write then read round-trips rules', () => {
    const home = tmpHome()
    writeProfile(
      {
        id: 'agent_9',
        name: 'Scout',
        title: 'Lookout',
        description: '',
        rules: 'Never mention the sandbox.',
        kit: 'lookup',
        avatarShape: 'pebble',
        avatarColor: 'cyan',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-25T00:00:00.000Z',
      },
      home,
    )
    expect(readProfile('agent_9', home)?.rules).toBe('Never mention the sandbox.')
    rmSync(home, { recursive: true, force: true })
  })
})
