import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import {
  applyTerminalOutcome,
  createRoutine,
  deleteRoutine,
  fireDueRoutines,
  isDue,
  listRoutines,
  pauseRoutine,
  resetRoutineIdsForTests,
  resolveSchedule,
  resumeRoutine,
  shouldStayQuiet,
  updateRoutine,
} from '../src/runtime/routines'
import { writeProfile, type AgentProfile } from '../src/runtime/profile'
import {
  completeMouth,
  enqueueRoutineFire,
  turnKickoff,
  type Session,
} from '../src/session'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-routines-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  return home
}

function seedStaff(home: string): void {
  const profile: AgentProfile = {
    id: 'staff',
    name: 'Chief of Staff',
    title: 'Chief of Staff',
    description: '',
    rules: '',
    kit: 'coordinator',
    avatarShape: 'marionette',
    avatarColor: 'staff',
    namedBy: 'app',
    skillIds: [],
    notifyOnUpdates: false,
    hiddenFromRail: false,
    createdAt: new Date().toISOString(),
    homeRepo: '',
    homePath: '',
  }
  writeProfile(profile, home)
}

function freshSession(): Session {
  resetIdsForTests()
  const agents = staffWithSisters()
  return {
    agents,
    activeAgentId: 'staff',
    threads: emptyThreads(agents),
    jobs: [],
    pendingFanout: null,
  }
}

beforeEach(() => {
  resetRoutineIdsForTests()
})

describe('routines CRUD', () => {
  test('create pause resume delete', () => {
    const home = tmpHome()
    seedStaff(home)
    const row = createRoutine(
      {
        agentId: 'staff',
        name: 'Morning check',
        prompt: 'Stay quiet if nothing changed.',
        schedule: '@daily',
      },
      home,
    )
    expect(row.enabled).toBe(true)
    expect(row.schedule).toBe('@daily')
    expect(listRoutines('staff', home)).toHaveLength(1)

    const paused = pauseRoutine('staff', row.id, home)
    expect(paused.enabled).toBe(false)
    const resumed = resumeRoutine('staff', row.id, home)
    expect(resumed.enabled).toBe(true)
    expect(resumed.lastError).toBeNull()

    deleteRoutine('staff', row.id, home)
    expect(listRoutines('staff', home)).toHaveLength(0)
    rmSync(home, { recursive: true, force: true })
  })

  test('never both schedule and trigger', () => {
    const home = tmpHome()
    seedStaff(home)
    expect(() =>
      createRoutine(
        {
          agentId: 'staff',
          name: 'Bad',
          prompt: 'x',
          schedule: '@daily',
          trigger: { type: 'webhook', ref: '/hook' },
        },
        home,
      ),
    ).toThrow(/both schedule and trigger/)

    const row = createRoutine(
      {
        agentId: 'staff',
        name: 'Hook',
        prompt: 'ping',
        trigger: { type: 'webhook', ref: '/hook' },
      },
      home,
    )
    expect(() =>
      updateRoutine('staff', row.id, { schedule: '@hourly', trigger: { type: 'github', ref: 'acme/app' } }, home),
    ).toThrow(/both schedule and trigger/)
    rmSync(home, { recursive: true, force: true })
  })
})

describe('schedule helpers', () => {
  test('vague daily and hourly defaults', () => {
    const created = '2026-09-12T14:37:00.000Z' // 9:37 CT on -5
    const daily = resolveSchedule('@daily', created)
    expect(daily.kind).toBe('daily')
    expect(daily.hour).toBe(9)
    expect(daily.minute).toBe(0)
    expect(daily.weekdays).toEqual([1, 2, 3, 4, 5])

    const hourly = resolveSchedule('@hourly', created, 'America/Chicago')
    expect(hourly.kind).toBe('hourly')
    expect(hourly.minute).toBe(37)

    const named = resolveSchedule('9:00', created)
    expect(named.kind).toBe('named')
    expect(named.hour).toBe(9)
    expect(named.minute).toBe(0)
  })

  test('isDue respects enabled schedule window and lastRunAt', () => {
    const home = tmpHome()
    seedStaff(home)
    // Pick a fixed local weekday 9:00 CT.
    const created = '2026-09-08T14:00:00.000Z' // Mon 9:00 CT
    const row = createRoutine(
      {
        agentId: 'staff',
        name: 'Nine',
        prompt: 'check',
        schedule: '@daily',
        createdAt: created,
      },
      home,
    )
    // Tuesday 9:00 CT = 14:00 UTC (CDT UTC-5 in Sep)
    const dueAt = new Date('2026-09-08T14:00:30.000Z')
    expect(isDue(row, dueAt)).toBe(true)

    const after = { ...row, lastRunAt: '2026-09-08T14:00:10.000Z' }
    expect(isDue(after, dueAt)).toBe(false)

    const paused = { ...row, enabled: false }
    expect(isDue(paused, dueAt)).toBe(false)

    const weekend = new Date('2026-09-12T14:00:30.000Z') // Sat
    expect(isDue(row, weekend)).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})

describe('stay quiet + fire path', () => {
  test('shouldStayQuiet matches prompt language', () => {
    expect(shouldStayQuiet('Stay quiet if nothing changed.')).toBe(true)
    expect(shouldStayQuiet('Report status every morning')).toBe(false)
    expect(shouldStayQuiet('no change — skip')).toBe(true)
  })

  test('enqueueRoutineFire sets kickoff routine without speaking triggered', () => {
    const session = freshSession()
    const next = enqueueRoutineFire(session, 'staff', 'Stay quiet if nothing changed.', 'routine_1')
    const last = next.threads.staff.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') {
      expect(last.from).toBe('user')
      expect(last.text).toBe('Stay quiet if nothing changed.')
      expect(last.kickoff).toBe('routine')
      expect(last.text.toLowerCase()).not.toContain('routine triggered')
    }
    expect(next.threads.staff.mouth).toBe('answer')
    expect(turnKickoff(next, 'staff')).toBe('routine')

    const quiet = completeMouth(next, 'staff', '')
    const spoken = quiet.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')
    expect(spoken).toHaveLength(0)
    expect(quiet.threads.staff.mouth).toBe('idle')
  })

  test('fireDueRoutines fires schedule and skips filler when stay quiet returns empty', async () => {
    const home = tmpHome()
    seedStaff(home)
    const created = '2026-09-08T14:00:00.000Z'
    const row = createRoutine(
      {
        agentId: 'staff',
        name: 'Quiet tick',
        prompt: 'Stay quiet if nothing changed.',
        schedule: '@daily',
        createdAt: created,
      },
      home,
    )
    const calls: string[] = []
    const result = await fireDueRoutines({
      now: new Date('2026-09-08T14:00:30.000Z'),
      home,
      seams: {
        onFire: ({ routineId, prompt }) => {
          calls.push(routineId)
          expect(prompt).toContain('Stay quiet')
          return ''
        },
      },
    })
    expect(result.fired).toEqual([row.id])
    expect(calls).toEqual([row.id])
    const stored = listRoutines('staff', home)[0]
    expect(stored?.lastRunAt).toBeTruthy()
    rmSync(home, { recursive: true, force: true })
  })
})

describe('honesty + finite', () => {
  test('missing connector pauses event routine once', async () => {
    const home = tmpHome()
    seedStaff(home)
    const row = createRoutine(
      {
        agentId: 'staff',
        name: 'PR watch',
        prompt: 'Summarize the PR.',
        trigger: { type: 'github', ref: 'acme/app', event: 'pull_request' },
      },
      home,
    )
    let checks = 0
    const first = await fireDueRoutines({
      home,
      seams: {
        hasConnector: () => {
          checks += 1
          return false
        },
        onFire: () => {
          throw new Error('should not fire')
        },
      },
    })
    expect(first.paused).toEqual([row.id])
    const stored = listRoutines('staff', home)[0]
    expect(stored?.enabled).toBe(false)
    expect(stored?.lastError).toMatch(/Need GitHub connector/)

    const second = await fireDueRoutines({
      home,
      seams: {
        hasConnector: () => {
          checks += 1
          return false
        },
        onFire: () => {
          throw new Error('should not fire')
        },
      },
    })
    expect(second.paused).toEqual([])
    expect(listRoutines('staff', home)[0]?.lastError).toMatch(/Need GitHub connector/)
    expect(checks).toBeGreaterThanOrEqual(1)
    rmSync(home, { recursive: true, force: true })
  })

  test('finite helper pauses after terminal event', () => {
    const routine = {
      id: 'routine_x',
      agentId: 'staff',
      name: 'Until merged',
      prompt: 'watch',
      enabled: true,
      trigger: { type: 'github' as const, event: 'pr-merged' },
      createdAt: new Date().toISOString(),
      finite: true,
      terminalOn: 'pr-merged',
    }
    const mid = applyTerminalOutcome(routine, 'pull_request')
    expect(mid.terminal).toBe(false)
    expect(mid.routine.enabled).toBe(true)

    const done = applyTerminalOutcome(routine, 'pr-merged')
    expect(done.terminal).toBe(true)
    expect(done.action).toBe('pause')
    expect(done.routine.enabled).toBe(false)
  })
})
