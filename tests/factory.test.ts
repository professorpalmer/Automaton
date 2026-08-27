import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { allFrameNames } from '../scripts/bake-marks'
import { DEFAULT_AGENTS, bindHomes, emptyThreads, resetIdsForTests } from '../src/domain'
import { applyHomeBinds, createAgent, destroyAgent, ensureMarkFrames, hydrateSession, markForAgent, resolveFramePath } from '../src/runtime/factory'
import { readProfile, writeProfile } from '../src/runtime/profile'
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
    expect(created.agent.name).toBe('New automaton')
    expect(created.profile.kit).toBe('code')
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
    expect(next.agents.map((agent) => agent.id).sort()).toEqual(['agent_1', 'staff'].sort())
    expect(next.agents.some((agent) => agent.id === 'kernel')).toBe(false)
    expect(next.agents.some((agent) => agent.id === created.agent.id)).toBe(true)
    expect(next.threads[created.agent.id]).toBeTruthy()
    expect(next.agents.find((agent) => agent.id === created.agent.id)?.name).toBe('Scout')
    rmSync(home, { recursive: true, force: true })
  })

  test('named create can take a code kit without stealing hydrate focus', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home, name: 'Marionette', kit: 'code' })
    expect(created.agent.name).toBe('Marionette')
    expect(created.profile.kit).toBe('code')
    expect(created.profile.namedBy).toBe('user')
    const next = hydrateSession(seedSession(), home)
    expect(next.activeAgentId).toBe('staff')
    rmSync(home, { recursive: true, force: true })
  })

  test('hydrate seeds Staff, Kernel, and Research on a fresh home', () => {
    resetIdsForTests()
    const home = tmpHome()
    const next = hydrateSession(seedSession(), home)
    expect(next.agents.map((agent) => agent.id)).toEqual(['staff', 'kernel', 'research'])
    expect(next.agents.find((agent) => agent.id === 'staff')?.name).toBe('Chief of Staff')
    expect(next.agents.find((agent) => agent.id === 'kernel')?.name).toBe('Kernel')
    expect(next.agents.find((agent) => agent.id === 'research')?.name).toBe('Research')
    expect(next.threads.kernel).toBeTruthy()
    expect(next.threads.research).toBeTruthy()
    expect(next.activeAgentId).toBe('staff')
    rmSync(home, { recursive: true, force: true })
  })

  test('hydrate keeps GoalRuns whose owner is still on disk', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home, name: 'Marionette', kit: 'code' })
    const next = hydrateSession(
      {
        agents: [...DEFAULT_AGENTS, created.agent],
        activeAgentId: 'staff',
        threads: emptyThreads([...DEFAULT_AGENTS, created.agent]),
        jobs: [
          {
            id: 'job_goal',
            ownerAgentId: created.agent.id,
            goal: 'validate https://github.com/professorpalmer/marionette/pull/12',
            status: 'running',
            kind: 'analyze',
            goalId: 'goal_1',
            criterionId: 'crit_1',
            pmJobId: 'job_pm_reattach',
          },
        ],
        goals: [
          {
            id: 'goal_1',
            text: 'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?',
            coordinatorId: 'staff',
            ownerAgentId: created.agent.id,
            criteria: [
              { id: 'crit_1', label: 'validate', kind: 'analyze', work: 'validate https://github.com/professorpalmer/marionette/pull/12', status: 'running' },
              { id: 'crit_2', label: 'absorb', kind: 'implement', work: 'absorb https://github.com/professorpalmer/marionette/pull/12', status: 'pending' },
            ],
            receipts: [],
            status: 'running',
            activeCriterionId: 'crit_1',
          },
        ],
        pendingFanout: null,
      },
      home,
    )
    expect(next.goals).toHaveLength(1)
    expect(next.goals?.[0]?.id).toBe('goal_1')
    expect(next.jobs[0]?.goalId).toBe('goal_1')
    expect(next.jobs[0]?.pmJobId).toBe('job_pm_reattach')
    rmSync(home, { recursive: true, force: true })
  })

  test('applyHomeBinds writes the github slug onto the profile', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home, name: 'Puppetmaster', kit: 'code' })
    const binds = bindHomes(
      'Point Puppetmaster at https://github.com/example/Puppetmaster',
      [created.agent],
    )
    applyHomeBinds(binds, home)
    expect(readProfile(created.agent.id, home)?.homeRepo).toBe('example/Puppetmaster')
    rmSync(home, { recursive: true, force: true })
  })

  test('changing shape and color bakes that mark and the rail reads it', () => {
    resetIdsForTests()
    const home = tmpHome()
    const created = createAgent({ home, name: 'Marionette' })
    const next = { ...created.profile, avatarShape: 'hex', avatarColor: 'blue' }
    writeProfile(next, home)
    ensureMarkFrames(next.avatarShape, next.avatarColor, home)
    expect(markForAgent(created.agent.id, home)).toEqual({ shape: 'hex', color: 'blue' })
    expect(existsSync(resolveFramePath('hex', 'blue', 'rest', home))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
