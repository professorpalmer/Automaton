import { beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHandle } from '../src/domain'
import {
  WATCH_UNAVAILABLE_GRACE,
  ensureDispatched,
  findReusableAnalyze,
  implementSeedRoot,
  isReusableAnalyzePrior,
  normalizeGoal,
  resetJobsForTests,
} from '../src/runtime/jobs.ts'
import { writeProfile } from '../src/runtime/profile'
import type { StatusSnap } from '../src/runtime/pm.ts'

const GOAL = 'Look up why Send stays Send in Automaton staff.'
const FINDING = 'Send stays Send while a Kernel job flies.'

function job(patch: Partial<JobHandle> & Pick<JobHandle, 'id'>): JobHandle {
  return {
    ownerAgentId: 'kernel',
    goal: GOAL,
    status: 'running',
    kind: 'analyze',
    ...patch,
  }
}

function completeAnalyze(id: string, ownerAgentId = 'kernel'): JobHandle {
  return job({
    id,
    ownerAgentId,
    status: 'complete',
    pmJobId: `job_${id}`,
  })
}

function hooks() {
  const attached: string[] = []
  const complete: string[] = []
  const fail: string[] = []
  return {
    attached,
    complete,
    fail,
    onAttached: (pmJobId: string) => {
      attached.push(pmJobId)
    },
    onComplete: (spoken: string) => {
      complete.push(spoken)
    },
    onFail: (spoken: string) => {
      fail.push(spoken)
    },
  }
}

function live(
  rows: Record<string, { snap: StatusSnap; refs?: unknown }>,
) {
  return {
    readStatus: (pmJobId: string): StatusSnap => {
      const row = rows[pmJobId]
      if (!row) throw new Error(`missing status ${pmJobId}`)
      return row.snap
    },
    readArtifactRefs: (pmJobId: string): unknown => rows[pmJobId]?.refs ?? [],
  }
}

function completeFinding(claim = FINDING): { snap: StatusSnap; refs: unknown } {
  return {
    snap: { job: { status: 'complete' }, delivery: { successful: true } },
    refs: [{ type: 'finding', claim }],
  }
}

function fakeFiles() {
  return { configPath: '/tmp/automaton-test.json', goalPath: '/tmp/automaton-test.goal.txt' }
}

describe('durable analyze dispatch', () => {
  beforeEach(() => {
    resetJobsForTests()
  })

  test('normalized goals collapse case and whitespace', () => {
    expect(normalizeGoal('  Look   UP why  ')).toBe('look up why')
  })

  test('same owner+goal complete analyze is a reuse candidate; different owner is not', () => {
    const current = job({ id: 'job_now' })
    const sameOwner = completeAnalyze('prior')
    const otherOwner = completeAnalyze('research_prior', 'research')
    expect(isReusableAnalyzePrior(sameOwner, current)).toBe(true)
    expect(isReusableAnalyzePrior(otherOwner, current)).toBe(false)
    expect(isReusableAnalyzePrior(completeAnalyze('prior'), job({ id: 'job_impl', kind: 'implement' }))).toBe(
      false,
    )
  })

  test('live complete with a finding is a hit; hollow/failed/unsuccessful/stalled miss', () => {
    const current = job({ id: 'job_now' })
    const prior = completeAnalyze('prior')
    const readers = live({
      job_prior: completeFinding(),
    })
    expect(findReusableAnalyze(current, [prior], readers.readStatus, readers.readArtifactRefs)).toEqual({
      pmJobId: 'job_prior',
      spoken: FINDING,
    })
    expect(
      findReusableAnalyze(
        current,
        [prior],
        () => ({ job: { status: 'complete' } }),
        () => [],
      ),
    ).toBeNull()
    expect(
      findReusableAnalyze(
        current,
        [{ ...prior, status: 'failed' }],
        readers.readStatus,
        readers.readArtifactRefs,
      ),
    ).toBeNull()
    expect(
      findReusableAnalyze(
        current,
        [prior],
        () => ({ job: { status: 'complete' }, delivery: { successful: false } }),
        () => [{ type: 'finding', claim: FINDING }],
      ),
    ).toBeNull()
    expect(
      findReusableAnalyze(
        current,
        [prior],
        () => ({ job: { status: 'stalled' } }),
        () => [{ type: 'finding', claim: FINDING }],
      ),
    ).toBeNull()
    expect(
      findReusableAnalyze(job({ id: 'job_impl', kind: 'implement' }), [prior], readers.readStatus, readers.readArtifactRefs),
    ).toBeNull()
  })

  test('persisted pmJobId watches and attaches without spawning', async () => {
    const recorded = hooks()
    const spawned: string[][] = []
    const current = job({ id: 'job_local', pmJobId: 'job_persisted' })
    await ensureDispatched(current, recorded, [], {
      ...live({ job_persisted: completeFinding() }),
      spawn: async (argv) => {
        spawned.push(argv)
        return { pmJobId: 'job_should_not_spawn' }
      },
      analyzeFiles: fakeFiles,
    })
    expect(spawned).toEqual([])
    expect(recorded.attached).toEqual(['job_persisted'])
    expect(recorded.complete).toEqual([FINDING])
    expect(recorded.fail).toEqual([])
  })

  test('same owner+goal complete analyze with substantive refs reuses', async () => {
    const recorded = hooks()
    const spawned: string[][] = []
    const current = job({ id: 'job_now' })
    const prior = completeAnalyze('prior')
    await ensureDispatched(current, recorded, [prior], {
      ...live({ job_prior: completeFinding() }),
      spawn: async (argv) => {
        spawned.push(argv)
        return { pmJobId: 'job_should_not_spawn' }
      },
      analyzeFiles: fakeFiles,
    })
    expect(spawned).toEqual([])
    expect(recorded.attached).toEqual(['job_prior'])
    expect(recorded.complete).toEqual([FINDING])
  })

  test('same goal different owner does not reuse', async () => {
    const recorded = hooks()
    const spawned: string[][] = []
    const current = job({ id: 'job_now' })
    const prior = completeAnalyze('research_prior', 'research')
    await ensureDispatched(current, recorded, [prior], {
      ...live({
        job_research_prior: completeFinding('Research already answered.'),
        job_fresh: completeFinding('Fresh analyze.'),
      }),
      spawn: async (argv) => {
        spawned.push(argv)
        return { pmJobId: 'job_fresh' }
      },
      analyzeFiles: fakeFiles,
    })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toContain('--launch-key')
    expect(spawned[0][spawned[0].indexOf('--launch-key') + 1]).toBe('job_now')
    expect(recorded.attached).toEqual(['job_fresh'])
    expect(recorded.complete).toEqual(['Fresh analyze.'])
  })

  test('hollow, unsuccessful, and stalled live artifacts are rejected', async () => {
    const cases: { name: string; snap: StatusSnap; refs: unknown }[] = [
      { name: 'hollow', snap: { job: { status: 'complete' } }, refs: [] },
      {
        name: 'unsuccessful',
        snap: { job: { status: 'complete' }, delivery: { successful: false } },
        refs: [{ type: 'finding', claim: FINDING }],
      },
      {
        name: 'stalled',
        snap: { job: { status: 'stalled' } },
        refs: [{ type: 'finding', claim: FINDING }],
      },
    ]
    for (const row of cases) {
      resetJobsForTests()
      const recorded = hooks()
      const spawned: string[][] = []
      await ensureDispatched(job({ id: `job_${row.name}` }), recorded, [completeAnalyze('prior')], {
        ...live({
          job_prior: { snap: row.snap, refs: row.refs },
          job_fresh: completeFinding('Spawned after miss.'),
        }),
        spawn: async (argv) => {
          spawned.push(argv)
          return { pmJobId: 'job_fresh' }
        },
        analyzeFiles: fakeFiles,
      })
      expect(spawned).toHaveLength(1)
      expect(recorded.complete).toEqual(['Spawned after miss.'])
    }
  })

  test('implement never reuses a prior analyze or implement', async () => {
    const recorded = hooks()
    const spawned: string[][] = []
    const current = job({
      id: 'job_impl',
      kind: 'implement',
      goal: 'Kernel, the mention insert breaks undo on the composer path.',
    })
    const priors: JobHandle[] = [
      completeAnalyze('prior'),
      job({
        id: 'impl_prior',
        kind: 'implement',
        status: 'complete',
        pmJobId: 'job_impl_prior',
        goal: current.goal,
      }),
    ]
    await ensureDispatched(current, recorded, priors, {
      ...live({
        job_prior: completeFinding(),
        job_impl_prior: completeFinding('Old implement.'),
        job_fresh_impl: completeFinding('Fresh sandbox work.'),
      }),
      spawn: async (argv) => {
        spawned.push(argv)
        return { pmJobId: 'job_fresh_impl' }
      },
      implementFiles: fakeFiles,
    })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toContain('--launch-key')
    expect(spawned[0][spawned[0].indexOf('--launch-key') + 1]).toBe('job_impl')
    expect(recorded.attached).toEqual(['job_fresh_impl'])
    expect(recorded.complete).toEqual(['Fresh sandbox work.'])
  })

  test('failed start can retry after guards clear', async () => {
    const recorded = hooks()
    let attempts = 0
    const seams = {
      ...live({ job_ok: completeFinding('Started on retry.') }),
      analyzeFiles: fakeFiles,
      spawn: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('spawn failed')
        return { pmJobId: 'job_ok' }
      },
    }
    const current = job({ id: 'job_retry' })
    await ensureDispatched(current, recorded, [], seams)
    expect(recorded.fail).toEqual(["Couldn't start."])
    expect(recorded.attached).toEqual([])
    await ensureDispatched(current, recorded, [], seams)
    expect(attempts).toBe(2)
    expect(recorded.attached).toEqual(['job_ok'])
    expect(recorded.complete).toEqual(['Started on retry.'])
  })

  test('reuse candidate status error is a miss and may spawn', async () => {
    const recorded = hooks()
    const spawned: string[][] = []
    await ensureDispatched(job({ id: 'job_now' }), recorded, [completeAnalyze('prior')], {
      readStatus: (pmJobId) => {
        if (pmJobId === 'job_prior') throw new Error('missing prior')
        return completeFinding('Fresh after miss.').snap
      },
      readArtifactRefs: (pmJobId) => {
        if (pmJobId === 'job_prior') throw new Error('missing prior refs')
        return completeFinding('Fresh after miss.').refs
      },
      spawn: async (argv) => {
        spawned.push(argv)
        return { pmJobId: 'job_fresh' }
      },
      analyzeFiles: fakeFiles,
      sleep: async () => undefined,
    })
    expect(spawned).toHaveLength(1)
    expect(recorded.attached).toEqual(['job_fresh'])
    expect(recorded.complete).toEqual(['Fresh after miss.'])
    expect(recorded.fail).toEqual([])
  })

  test('attached missing PM job fails instead of watching forever', async () => {
    const recorded = hooks()
    let reads = 0
    await ensureDispatched(job({ id: 'job_local', pmJobId: 'job_gone' }), recorded, [], {
      readStatus: () => {
        reads += 1
        throw new Error('missing status job_gone')
      },
      readArtifactRefs: () => {
        throw new Error('missing refs job_gone')
      },
      spawn: async () => {
        throw new Error('must not spawn')
      },
      sleep: async () => undefined,
      maxUnavailableStatusReads: WATCH_UNAVAILABLE_GRACE,
    })
    expect(reads).toBe(WATCH_UNAVAILABLE_GRACE + 1)
    expect(recorded.attached).toEqual(['job_gone'])
    expect(recorded.complete).toEqual([])
    expect(recorded.fail).toEqual(["Didn't land."])
  })

  test('readable running PM status continues until complete', async () => {
    const recorded = hooks()
    let reads = 0
    await ensureDispatched(job({ id: 'job_local', pmJobId: 'job_live' }), recorded, [], {
      readStatus: () => {
        reads += 1
        if (reads < 3) return { job: { status: 'running' } }
        return completeFinding().snap
      },
      readArtifactRefs: () => completeFinding().refs,
      spawn: async () => {
        throw new Error('must not spawn')
      },
      sleep: async () => undefined,
    })
    expect(reads).toBeGreaterThanOrEqual(3)
    expect(recorded.attached).toEqual(['job_live'])
    expect(recorded.complete).toEqual([FINDING])
    expect(recorded.fail).toEqual([])
  })

  test('complete with no finding fails closed instead of speaking Done.', async () => {
    const recorded = hooks()
    await ensureDispatched(job({ id: 'job_hollow_live', pmJobId: 'job_empty' }), recorded, [], {
      ...live({
        job_empty: { snap: { job: { status: 'complete' } }, refs: [] },
      }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(recorded.complete).toEqual([])
    expect(recorded.fail).toEqual(["Didn't land."])
  })
})

describe('bound product home', () => {
  test('implementSeedRoot uses a bound git checkout, not the fallback', () => {
    const fixture = join(tmpdir(), `automaton-seed-home-${Date.now()}`)
    const agents = join(tmpdir(), `automaton-seed-agents-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })
    const init = spawnSync('git', ['init'], { cwd: fixture, encoding: 'utf8' })
    expect(init.status).toBe(0)
    writeProfile(
      {
        id: 'agent_p',
        name: 'Puppetmaster',
        title: 'example/Puppetmaster',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'hex',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-25T00:00:00.000Z',
        homeRepo: 'example/Puppetmaster',
        homePath: fixture,
      },
      agents,
    )
    expect(implementSeedRoot('agent_p', '/fallback', agents)).toBe(fixture)
    expect(implementSeedRoot('missing', '/fallback', agents)).toBe('/fallback')
    rmSync(fixture, { recursive: true, force: true })
    rmSync(agents, { recursive: true, force: true })
  })
})

describe('box-shell dispatch', () => {
  beforeEach(() => {
    resetJobsForTests()
  })

  test('docker exec answers PATH without spawning Puppetmaster', async () => {
    const seen: string[] = []
    const h = hooks()
    await ensureDispatched(
      job({
        id: 'job_box_which',
        ownerAgentId: 'staff',
        kind: 'box-shell',
        goal: 'is claude on PATH',
      }),
      h,
      [],
      {
        spawn: async (argv) => {
          seen.push(argv.join(' '))
          throw new Error('pm must not start')
        },
        boxShell: (item) => {
          expect(item.kind).toBe('box-shell')
          return { ok: true, spoken: 'claude is on the computer at /usr/bin/claude.' }
        },
      },
    )
    expect(seen).toEqual([])
    expect(h.attached).toEqual([])
    expect(h.complete).toEqual(['claude is on the computer at /usr/bin/claude.'])
    expect(h.fail).toEqual([])
  })
})
