import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { allFrameNames } from '../scripts/bake-marks'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import { createAgent, destroyAgent, ensureMarkFrames, hydrateSession, resolveFramePath } from '../src/runtime/factory'
import { readProfile } from '../src/runtime/profile'
import type { Session } from '../src/session'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-factory-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

function seedSession(): Session {
  return {
    agents: DEFAULT_AGENTS,
    activeAgentId: 'staff',
    threads: emptyThreads(DEFAULT_AGENTS),
    jobs: [],
    pendingFanout: null,
  }
}

describe('agent factory', () => {
  test('create bakes frames before the mouth exists and deals a non-seed mark', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home })
    expect(created.agent.name).toBe('New Bot')
    expect(created.profile.kit).toBe('blank')
    expect(created.profile.namedBy).toBe('app')
    expect(['staff', 'kernel', 'research']).not.toContain(created.profile.avatarColor)
    for (const frame of allFrameNames()) {
      const path = resolveFramePath(created.profile.avatarShape, created.profile.avatarColor, frame, home)
      expect(existsSync(path)).toBe(true)
    }
    expect(existsSync(join(home, 'desktops', created.agent.id, 'browser'))).toBe(true)
    destroyAgent(created.agent.id, home)
    expect(readProfile(created.agent.id, home)).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })

  test('hydrate restores a disk profile without stealing the focused mouth', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home, name: 'Scout' })
    const next = hydrateSession(seedSession(), home)
    expect(next.activeAgentId).toBe('staff')
    expect(next.agents.some((agent) => agent.id === created.agent.id)).toBe(true)
    expect(next.threads[created.agent.id]).toBeTruthy()
    expect(next.agents.find((agent) => agent.id === created.agent.id)?.name).toBe('Scout')
    rmSync(home, { recursive: true, force: true })
  })

  test('cache hit skips a second bake', () => {
    const home = tmpHome()
    ensureMarkFrames('pebble', 'cyan', home)
    const first = resolveFramePath('pebble', 'cyan', 'rest', home)
    expect(existsSync(first)).toBe(true)
    ensureMarkFrames('pebble', 'cyan', home)
    expect(existsSync(first)).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
