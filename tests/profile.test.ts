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
    expect(staff?.name).toBe('Chief of Staff')
    expect(staff?.avatarShape).toBe('blob')
    expect(readProfile('kernel', home)).toBeNull()
    expect(readProfile('research', home)).toBeNull()
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
    expect(parsed.homeRepo).toBe('')
    expect(parsed.homePath).toBe('')
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
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    expect(readProfile('agent_9', home)?.rules).toBe('Never mention the sandbox.')
    rmSync(home, { recursive: true, force: true })
  })

  test('ensureSeedProfiles upgrades an app-named Staff mouth', () => {
    const home = tmpHome()
    writeProfile(
      {
        ...parseProfile({ name: 'Staff', kit: 'coordinator', namedBy: 'app' }, 'staff'),
        avatarShape: 'blob',
        avatarColor: 'staff',
      },
      home,
    )
    ensureSeedProfiles(home)
    expect(readProfile('staff', home)?.name).toBe('Chief of Staff')
    rmSync(home, { recursive: true, force: true })
  })

  test('ensureSeedProfiles leaves a user-named Staff mouth alone', () => {
    const home = tmpHome()
    writeProfile(
      {
        ...parseProfile({ name: 'Staff', kit: 'coordinator', namedBy: 'user' }, 'staff'),
        avatarShape: 'blob',
        avatarColor: 'staff',
      },
      home,
    )
    ensureSeedProfiles(home)
    expect(readProfile('staff', home)?.name).toBe('Staff')
    rmSync(home, { recursive: true, force: true })
  })

  test('ensureSeedProfiles drops app-named Kernel and Research', () => {
    const home = tmpHome()
    writeProfile(
      {
        ...parseProfile({ name: 'Kernel', kit: 'code', namedBy: 'app' }, 'kernel'),
        avatarShape: 'hex',
        avatarColor: 'kernel',
      },
      home,
    )
    writeProfile(
      {
        ...parseProfile({ name: 'Research', kit: 'lookup', namedBy: 'user' }, 'research'),
        avatarShape: 'tablet',
        avatarColor: 'research',
      },
      home,
    )
    ensureSeedProfiles(home)
    expect(readProfile('kernel', home)).toBeNull()
    expect(readProfile('research', home)?.name).toBe('Research')
    rmSync(home, { recursive: true, force: true })
  })
})
