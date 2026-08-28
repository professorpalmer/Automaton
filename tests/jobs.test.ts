import { beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WAITING_CHECKS, type JobHandle } from '../src/domain'
import {
  WATCH_UNAVAILABLE_GRACE,
  ensureDispatched,
  findReusableAnalyze,
  implementSeedRoot,
  isReusableAnalyzePrior,
  normalizeGoal,
  resetJobsForTests,
  resolveBoundProductCwd,
  resolveJobCwd,
} from '../src/runtime/jobs.ts'
import { listMachineProjects } from '../src/runtime/machine.ts'
import { writeProfile } from '../src/runtime/profile'
import { PRODUCT_ROOT, type StatusSnap } from '../src/runtime/pm.ts'

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
  const status: string[] = []
  const complete: string[] = []
  const fail: string[] = []
  const waiting: string[] = []
  const waitingUser: string[] = []
  return {
    attached,
    status,
    complete,
    fail,
    waiting,
    waitingUser,
    onAttached: (pmJobId: string) => {
      attached.push(pmJobId)
    },
    onStatus: (spoken: string) => {
      status.push(spoken)
    },
    onComplete: (spoken: string) => {
      complete.push(spoken)
    },
    onFail: (spoken: string) => {
      fail.push(spoken)
    },
    onWaitingExternal: (spoken: string) => {
      waiting.push(spoken)
    },
    onWaitingUser: (spoken: string) => {
      waitingUser.push(spoken)
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
    const live = job({
      id: 'job_live',
      goal: 'check Puppetmaster and Marionette for prs or open issues',
    })
    expect(
      isReusableAnalyzePrior(
        { ...completeAnalyze('old_live'), goal: live.goal },
        live,
      ),
    ).toBe(false)
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
    expect(recorded.status).toEqual(['Still running.'])
    expect(recorded.status).not.toContain('Done.')
    expect(recorded.complete).toEqual([FINDING])
    expect(recorded.fail).toEqual([])
  })

  test('immediate complete does not emit a keepalive status', async () => {
    const recorded = hooks()
    await ensureDispatched(job({ id: 'job_quick', pmJobId: 'job_ready' }), recorded, [], {
      ...live({ job_ready: completeFinding() }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(recorded.status).toEqual([])
    expect(recorded.complete).toEqual([FINDING])
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

  test('resolveJobCwd prefers a named machine checkout over the Automaton tree', () => {
    const root = join(tmpdir(), `automaton-machine-${Date.now()}`)
    const pm = join(root, 'Puppetmaster')
    mkdirSync(pm, { recursive: true })
    const init = spawnSync('git', ['init'], { cwd: pm, encoding: 'utf8' })
    expect(init.status).toBe(0)
    const projects = listMachineProjects(root)
    expect(
      resolveJobCwd(
        job({
          id: 'job_named_pm',
          goal: 'what script does puppetmaster have its model routing logic contained in?',
        }),
        '/fallback-automaton',
        join(tmpdir(), 'no-agents'),
        projects,
      ),
    ).toBe(pm)
    rmSync(root, { recursive: true, force: true })
  })

  test('resolveJobCwd uses the owner mouth name when the goal only says the repo', () => {
    const root = join(tmpdir(), `automaton-machine-owner-${Date.now()}`)
    const pm = join(root, 'Puppetmaster')
    const agents = join(tmpdir(), `automaton-owner-agents-${Date.now()}`)
    mkdirSync(pm, { recursive: true })
    const init = spawnSync('git', ['init'], { cwd: pm, encoding: 'utf8' })
    expect(init.status).toBe(0)
    writeProfile(
      {
        id: 'agent_p',
        name: 'Puppetmaster',
        title: '',
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
        homeRepo: '',
        homePath: '',
      },
      agents,
    )
    const projects = listMachineProjects(root)
    expect(
      resolveJobCwd(
        job({
          id: 'job_owner_pm',
          ownerAgentId: 'agent_p',
          goal: 'Look at the repo and find the router logic',
        }),
        '/fallback-automaton',
        agents,
        projects,
      ),
    ).toBe(pm)
    rmSync(root, { recursive: true, force: true })
    rmSync(agents, { recursive: true, force: true })
  })

  test('resolveBoundProductCwd stays empty when nothing is bound', () => {
    const empty = join(tmpdir(), `automaton-unbound-${Date.now()}`)
    mkdirSync(empty, { recursive: true })
    expect(
      resolveBoundProductCwd(
        job({
          id: 'job_unbound',
          ownerAgentId: 'agent_none',
          kind: 'promote',
          goal: 'merge dest to main',
        }),
        empty,
        [],
      ),
    ).toBeUndefined()
    expect(
      resolveJobCwd(
        job({
          id: 'job_unbound_fallback',
          ownerAgentId: 'agent_none',
          kind: 'analyze',
          goal: 'look at the dest checkout',
        }),
        PRODUCT_ROOT,
        empty,
        [],
      ),
    ).toBe(PRODUCT_ROOT)
    rmSync(empty, { recursive: true, force: true })
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
    expect(h.status).toEqual([])
    expect(h.complete).toEqual(['claude is on the computer at /usr/bin/claude.'])
    expect(h.fail).toEqual([])
  })

  test('long box-shell emits one delayed install status then completes', async () => {
    let release!: (value: { ok: boolean; spoken: string }) => void
    const gate = new Promise<{ ok: boolean; spoken: string }>((resolve) => {
      release = resolve
    })
    const ticks: Array<() => void> = []
    const recorded = hooks()
    const done = ensureDispatched(
      job({
        id: 'job_apt',
        ownerAgentId: 'staff',
        kind: 'box-shell',
        goal: 'install curl on the computer',
      }),
      recorded,
      [],
      {
        boxShell: () => gate,
        sleep: () => new Promise<void>((resolve) => ticks.push(resolve)),
      },
    )
    await Promise.resolve()
    expect(ticks).toHaveLength(1)
    expect(recorded.status).toEqual([])
    ticks[0]?.()
    await Promise.resolve()
    expect(recorded.status).toEqual(['Still installing curl.'])
    expect(recorded.status).not.toContain('Done.')
    expect(recorded.complete).toEqual([])
    release({ ok: true, spoken: 'Installed curl on the computer.' })
    await done
    expect(recorded.complete).toEqual(['Installed curl on the computer.'])
    expect(recorded.status).toEqual(['Still installing curl.'])
    expect(recorded.fail).toEqual([])
  })
})

describe('land and ship dispatch', () => {
  beforeEach(() => {
    resetJobsForTests()
  })

  test('promote does not spawn Puppetmaster', async () => {
    const seen: string[] = []
    const h = hooks()
    await ensureDispatched(
      job({
        id: 'job_land',
        ownerAgentId: 'agent_m',
        kind: 'promote',
        goal: 'merge dest to main',
      }),
      h,
      [],
      {
        spawn: async (argv) => {
          seen.push(argv.join(' '))
          throw new Error('pm must not start')
        },
        promote: (item) => {
          expect(item.kind).toBe('promote')
          return { ok: true, spoken: 'dev and main are equal.' }
        },
      },
    )
    expect(seen).toEqual([])
    expect(h.complete).toEqual(['dev and main are equal.'])
    expect(h.fail).toEqual([])
  })

  test('ship fail stays off Puppetmaster', async () => {
    const h = hooks()
    await ensureDispatched(
      job({
        id: 'job_ship',
        ownerAgentId: 'agent_m',
        kind: 'ship',
        goal: 'ship a new release',
      }),
      h,
      [],
      {
        spawn: async () => {
          throw new Error('pm must not start')
        },
        ship: () => ({ ok: false, spoken: 'Need a version on dest before tagging.' }),
      },
    )
    expect(h.complete).toEqual([])
    expect(h.fail).toEqual(['Need a version on dest before tagging.'])
  })

  test('waiting jobs are not dispatched', async () => {
    const seen: string[] = []
    const h = hooks()
    await ensureDispatched(job({ id: 'job_parked', status: 'waiting' }), h, [], {
      spawn: async (argv) => {
        seen.push(argv.join(' '))
        throw new Error('pm must not start')
      },
    })
    expect(seen).toEqual([])
    expect(h.complete).toEqual([])
    expect(h.fail).toEqual([])
    expect(h.waitingUser).toEqual([])
  })

  test('missing checkout and host auth wait on the user; ordinary fail stays failed', async () => {
    const missing = hooks()
    await ensureDispatched(
      job({
        id: 'job_land_bind',
        ownerAgentId: 'agent_m',
        kind: 'promote',
        goal: 'merge dest to main',
      }),
      missing,
      [],
      {
        spawn: async () => {
          throw new Error('pm must not start')
        },
        promote: () => ({
          ok: false,
          spoken: 'Need a product checkout to land dest.',
          waitingUser: true,
        }),
      },
    )
    expect(missing.waitingUser).toEqual(['Need a product checkout to land dest.'])
    expect(missing.fail).toEqual([])
    expect(missing.complete).toEqual([])

    const auth = hooks()
    await ensureDispatched(
      job({
        id: 'job_land_auth',
        ownerAgentId: 'agent_m',
        kind: 'promote',
        goal: 'merge dest to main',
      }),
      auth,
      [],
      {
        spawn: async () => {
          throw new Error('pm must not start')
        },
        promote: () => ({
          ok: false,
          spoken: 'HTTP 403: Resource not accessible by integration',
          waitingUser: true,
        }),
      },
    )
    expect(auth.waitingUser).toEqual(['HTTP 403: Resource not accessible by integration'])
    expect(auth.fail).toEqual([])

    const failed = hooks()
    await ensureDispatched(
      job({
        id: 'job_land_conflict',
        ownerAgentId: 'agent_m',
        kind: 'promote',
        goal: 'merge dest to main',
      }),
      failed,
      [],
      {
        spawn: async () => {
          throw new Error('pm must not start')
        },
        promote: () => ({ ok: false, spoken: 'not mergeable: merge conflict' }),
      },
    )
    expect(failed.fail).toEqual(['not mergeable: merge conflict'])
    expect(failed.waitingUser).toEqual([])
    expect(failed.waiting).toEqual([])
  })

  test('Puppetmaster auth denial waits on the user; ordinary miss still fails', async () => {
    const auth = hooks()
    await ensureDispatched(job({ id: 'job_pm_auth', pmJobId: 'job_denied' }), auth, [], {
      ...live({
        job_denied: {
          snap: { job: { status: 'failed', error: 'HTTP 401 Unauthorized' } },
          refs: [],
        },
      }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(auth.waitingUser).toEqual(['HTTP 401 Unauthorized'])
    expect(auth.fail).toEqual([])
    expect(auth.complete).toEqual([])

    const miss = hooks()
    await ensureDispatched(job({ id: 'job_pm_miss', pmJobId: 'job_empty' }), miss, [], {
      ...live({
        job_empty: { snap: { job: { status: 'complete' } }, refs: [] },
      }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(miss.fail).toEqual(["Didn't land."])
    expect(miss.waitingUser).toEqual([])
  })

  test('waiting promote retries without completing or failing early', async () => {
    let calls = 0
    const sleeps: number[] = []
    const h = hooks()
    await ensureDispatched(
      job({
        id: 'job_land_wait',
        ownerAgentId: 'agent_m',
        kind: 'promote',
        goal: 'merge dest to main',
      }),
      h,
      [],
      {
        spawn: async () => {
          throw new Error('pm must not start')
        },
        externalWaitMs: 0,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        promote: (item) => {
          calls += 1
          if (calls < 3) {
            if (calls > 1) expect(item.lastNote).toBe(WAITING_CHECKS)
            return { ok: false, spoken: WAITING_CHECKS, waitingExternal: true }
          }
          expect(item.lastNote).toBe(WAITING_CHECKS)
          return { ok: true, spoken: 'dev and main are equal.' }
        },
      },
    )
    expect(calls).toBe(3)
    expect(sleeps).toContain(0)
    expect(h.waiting).toEqual([WAITING_CHECKS, WAITING_CHECKS])
    expect(h.status).toEqual([WAITING_CHECKS])
    expect(h.complete).toEqual(['dev and main are equal.'])
    expect(h.fail).toEqual([])
  })

  test('restarted running promote dispatches again and converges', async () => {
    const handle = job({
      id: 'job_land_restart',
      ownerAgentId: 'agent_m',
      kind: 'promote',
      goal: 'merge dest to main',
    })
    let calls = 0
    const first = hooks()
    await ensureDispatched(handle, first, [], {
      externalWaitMs: 0,
      sleep: async () => {},
      promote: () => {
        calls += 1
        if (calls === 1) return { ok: false, spoken: WAITING_CHECKS, waitingExternal: true }
        return { ok: true, spoken: 'dev and main are equal.' }
      },
    })
    expect(first.fail).toEqual([])
    expect(handle.status).toBe('running')
    resetJobsForTests()
    const second = hooks()
    await ensureDispatched(handle, second, [], {
      promote: () => ({ ok: true, spoken: 'dev and main are equal.' }),
    })
    expect(second.complete).toEqual(['dev and main are equal.'])
    expect(second.fail).toEqual([])
  })

  test('unbound host promote and ship wait before any git/gh and do not use PRODUCT_ROOT', async () => {
    const emptyHome = join(tmpdir(), `automaton-host-unbound-${Date.now()}`)
    mkdirSync(emptyHome, { recursive: true })
    const prevProjects = process.env.AUTOMATON_PROJECTS_ROOT
    const prevHome = process.env.AUTOMATON_HOME
    process.env.AUTOMATON_PROJECTS_ROOT = emptyHome
    process.env.AUTOMATON_HOME = emptyHome
    try {
      for (const kind of ['promote', 'ship'] as const) {
        resetJobsForTests()
        const commands: { argv: string[]; cwd: string }[] = []
        const recorded = hooks()
        await ensureDispatched(
          job({
            id: `job_unbound_${kind}`,
            ownerAgentId: 'agent_unbound',
            kind,
            goal: kind === 'promote' ? 'merge dest to main' : 'ship a new release',
          }),
          recorded,
          [],
          {
            spawn: async () => {
              throw new Error('pm must not start')
            },
            land: {
              run: (argv, cwd) => {
                commands.push({ argv, cwd })
                return { status: 0, stdout: '', stderr: '' }
              },
            },
          },
        )
        expect(commands).toEqual([])
        expect(commands.every((row) => row.cwd !== PRODUCT_ROOT)).toBe(true)
        expect(recorded.waitingUser).toEqual([
          kind === 'promote' ? 'Need a product checkout to land dest.' : 'Need a product checkout to ship.',
        ])
        expect(recorded.fail).toEqual([])
        expect(recorded.complete).toEqual([])
      }
    } finally {
      if (prevProjects === undefined) delete process.env.AUTOMATON_PROJECTS_ROOT
      else process.env.AUTOMATON_PROJECTS_ROOT = prevProjects
      if (prevHome === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prevHome
      rmSync(emptyHome, { recursive: true, force: true })
    }
  })

  test('filesystem permission denied and artifact HTTP 401 stay failed; status.job.error waits', async () => {
    const perm = hooks()
    await ensureDispatched(job({ id: 'job_perm', pmJobId: 'job_perm' }), perm, [], {
      readStatus: () => {
        throw new Error('EACCES: permission denied')
      },
      readArtifactRefs: () => {
        throw new Error('EACCES: permission denied')
      },
      spawn: async () => {
        throw new Error('must not spawn')
      },
      sleep: async () => undefined,
      maxUnavailableStatusReads: 0,
    })
    expect(perm.fail).toEqual(["Didn't land."])
    expect(perm.waitingUser).toEqual([])

    const artifact = hooks()
    await ensureDispatched(job({ id: 'job_art', pmJobId: 'job_art' }), artifact, [], {
      ...live({
        job_art: {
          snap: { job: { status: 'failed' } },
          refs: [
            { type: 'finding', claim: 'the test log said HTTP 401 Unauthorized and gh auth login' },
          ],
        },
      }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(artifact.fail).toEqual(["Didn't land."])
    expect(artifact.waitingUser).toEqual([])

    const status = hooks()
    await ensureDispatched(job({ id: 'job_status_auth', pmJobId: 'job_status_auth' }), status, [], {
      ...live({
        job_status_auth: {
          snap: { job: { status: 'failed', error: 'HTTP 401 Unauthorized' } },
          refs: [],
        },
      }),
      spawn: async () => {
        throw new Error('must not spawn')
      },
    })
    expect(status.waitingUser).toEqual(['HTTP 401 Unauthorized'])
    expect(status.fail).toEqual([])
  })

  test('missing OpenRouter key waits on the user when the hook exists', async () => {
    const emptyHome = join(tmpdir(), `automaton-nokey-${Date.now()}`)
    mkdirSync(emptyHome, { recursive: true })
    const prevHome = process.env.AUTOMATON_HOME
    const prevKey = process.env.OPENROUTER_API_KEY
    process.env.AUTOMATON_HOME = emptyHome
    delete process.env.OPENROUTER_API_KEY
    try {
      const recorded = hooks()
      await ensureDispatched(job({ id: 'job_nokey' }), recorded, [], { analyzeFiles: fakeFiles })
      expect(recorded.waitingUser).toEqual(['Need an OpenRouter key.'])
      expect(recorded.fail).toEqual([])
      expect(recorded.complete).toEqual([])

      resetJobsForTests()
      const fail: string[] = []
      await ensureDispatched(
        job({ id: 'job_nokey_fail' }),
        {
          onAttached: () => undefined,
          onComplete: () => undefined,
          onFail: (spoken) => {
            fail.push(spoken)
          },
        },
        [],
        { analyzeFiles: fakeFiles },
      )
      expect(fail).toEqual(['Need an OpenRouter key.'])
    } finally {
      if (prevHome === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prevHome
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prevKey
      rmSync(emptyHome, { recursive: true, force: true })
    }
  })
})
