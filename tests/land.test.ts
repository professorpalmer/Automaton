import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WAITING_CHECKS, type JobHandle } from '../src/domain'
import { isDefinitiveAuthDenial, landCwd, runPromote, runShip } from '../src/runtime/land.ts'
import { sandboxDir } from '../src/runtime/pm.ts'

const SAME = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function remoteSha(args: string[], equal: boolean): { status: number; stdout: string; stderr: string } | null {
  if (args[0] !== 'git' || args[1] !== 'rev-parse') return null
  if (args[2] === 'origin/dev') return { status: 0, stdout: `${SAME}\n`, stderr: '' }
  if (args[2] === 'origin/main') return { status: 0, stdout: `${equal ? SAME : OTHER}\n`, stderr: '' }
  return null
}

function job(kind: JobHandle['kind'], goal: string, patch: Partial<JobHandle> = {}): JobHandle {
  return {
    id: 'job_land',
    ownerAgentId: 'agent_m',
    goal,
    status: 'running',
    kind,
    ...patch,
  }
}

function completeImplement(id: string, goalId: string): JobHandle {
  return {
    id,
    ownerAgentId: 'agent_m',
    goal: 'absorb the patch',
    status: 'complete',
    kind: 'implement',
    goalId,
  }
}

describe('host land', () => {
  test('promote with a goalId uses that GoalRun sandbox and fails closed on a miss', () => {
    const stamp = Date.now()
    const implA = completeImplement(`job_impl_a_${stamp}`, 'goal_a')
    const implB = completeImplement(`job_impl_b_${stamp}`, 'goal_b')
    const rootA = sandboxDir(implA.id)
    const rootB = sandboxDir(implB.id)
    mkdirSync(join(rootA, '.git'), { recursive: true })
    mkdirSync(join(rootB, '.git'), { recursive: true })
    const known = [implA, implB]
    const seen: string[] = []
    try {
      expect(landCwd(job('promote', 'merge dest to main', { goalId: 'goal_a' }), known, {})).toBe(rootA)
      expect(landCwd(job('promote', 'merge dest to main', { goalId: 'goal_b' }), known, {})).toBe(rootB)
      expect(landCwd(job('promote', 'merge dest to main', { goalId: 'goal_c' }), known, {})).toBeNull()
      expect(landCwd(job('promote', 'merge dest to main', { goalId: 'goal_c' }), known, { cwd: rootB })).toBe(
        rootB,
      )
      expect(landCwd(job('promote', 'merge dest to main', { goalId: 'goal_a' }), known, { cwd: rootB })).toBe(
        rootA,
      )
      expect(landCwd(job('promote', 'merge dest to main'), known, {})).toBe(rootB)
      let merged = false
      const result = runPromote(job('promote', 'merge dest to main', { goalId: 'goal_a' }), known, {
        cwd: rootB,
        run: (args, cwd) => {
          seen.push(cwd)
          if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
            return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
          }
          if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
            merged = true
            return { status: 0, stdout: '', stderr: '' }
          }
          return remoteSha(args, merged) ?? { status: 0, stdout: '', stderr: '' }
        },
      })
      expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
      expect(seen[0]).toBe(rootA)
      expect(seen.every((cwd) => cwd === rootA)).toBe(true)
      const missing = runPromote(job('promote', 'merge dest to main', { goalId: 'goal_c' }), known, {
        run: () => ({ status: 0, stdout: '', stderr: '' }),
      })
      expect(missing).toEqual({
        ok: false,
        spoken: 'Need a product checkout to land dest.',
        waitingUser: true,
        source: 'staff',
      })
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })

  test('promote pushes dest, opens dest into main when missing, then merges', () => {
    const root = join(tmpdir(), `automaton-land-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    let listed = 0
    let merged = false
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          listed += 1
          return {
            status: 0,
            stdout: listed === 1 ? '[]' : '[{"number":4,"state":"OPEN"}]',
            stderr: '',
          }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          merged = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return remoteSha(args, merged) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv[0]).toEqual(['git', 'push', '-u', 'origin', 'HEAD:dev'])
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(true)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge' && row[3] === '4')).toBe(true)
    expect(argv.some((row) => row[0] === 'git' && row[1] === 'fetch')).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote replay of an already-merged dest is success without a new PR', () => {
    const root = join(tmpdir(), `automaton-land-merged-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":9,"state":"MERGED"}]', stderr: '' }
        }
        return remoteSha(args, true) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(false)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge')).toBe(false)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote merges the open dest PR even when an older dest PR is merged', () => {
    const root = join(tmpdir(), `automaton-land-old-merged-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    let merged = false
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return {
            status: 0,
            stdout: '[{"number":9,"state":"MERGED"},{"number":12,"state":"OPEN"}]',
            stderr: '',
          }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          merged = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return remoteSha(args, merged) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(false)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge' && row[3] === '12')).toBe(true)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote creates a new dest PR when only an old merged PR exists and remotes diverge', () => {
    const root = join(tmpdir(), `automaton-land-diverge-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    let created = false
    let merged = false
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return {
            status: 0,
            stdout: created
              ? '[{"number":9,"state":"MERGED"},{"number":14,"state":"OPEN"}]'
              : '[{"number":9,"state":"MERGED"}]',
            stderr: '',
          }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'create') {
          created = true
          return { status: 0, stdout: 'https://example.test/14', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          merged = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return remoteSha(args, merged) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(true)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge' && row[3] === '14')).toBe(true)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote replay of an already-open dest merges that PR', () => {
    const root = join(tmpdir(), `automaton-land-open-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    let merged = false
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          merged = true
          return { status: 0, stdout: '', stderr: '' }
        }
        return remoteSha(args, merged) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(false)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge' && row[3] === '7')).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote waits while remotes differ after merge and completes once they match', () => {
    const root = join(tmpdir(), `automaton-land-wait-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    let equal = false
    const run = (args: string[]) => {
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
        return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
      }
      return remoteSha(args, equal) ?? { status: 0, stdout: '', stderr: '' }
    }
    const waiting = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(waiting).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    equal = true
    const done = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(done).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    rmSync(root, { recursive: true, force: true })
  })

  test('promote waits when a merged dest leaves OPEN before remotes match', () => {
    const root = join(tmpdir(), `automaton-land-merged-wait-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    let listed = 0
    let equal = false
    const run = (args: string[]) => {
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
        listed += 1
        if (listed === 1) return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        return { status: 0, stdout: listed === 2 ? '[{"number":7,"state":"MERGED"}]' : '[]', stderr: '' }
      }
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
        return { status: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'create') {
        return { status: 1, stdout: '', stderr: 'already exists' }
      }
      return remoteSha(args, equal) ?? { status: 0, stdout: '', stderr: '' }
    }
    const first = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(first).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    const retry = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(retry).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    equal = true
    const done = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(done).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    rmSync(root, { recursive: true, force: true })
  })

  test('promote does not complete from stale equal refs when fetch fails', () => {
    const root = join(tmpdir(), `automaton-land-stale-fetch-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'git' && args[1] === 'fetch') {
          return { status: 1, stdout: '', stderr: 'fatal: unable to access origin' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":9,"state":"MERGED"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'create') {
          return { status: 1, stdout: '', stderr: 'already exists' }
        }
        return remoteSha(args, true) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    rmSync(root, { recursive: true, force: true })
  })

  test('promote retries after waiting do not push dest again', () => {
    const root = join(tmpdir(), `automaton-land-repush-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    const run = (args: string[]) => {
      argv.push(args)
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
        return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
      }
      if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
        return { status: 1, stdout: '', stderr: 'X required status checks are pending' }
      }
      return remoteSha(args, false) ?? { status: 0, stdout: '', stderr: '' }
    }
    const first = runPromote(job('promote', 'merge dest to main'), [], { cwd: root, run })
    expect(first).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    expect(argv.filter((row) => row[0] === 'git' && row[1] === 'push')).toHaveLength(1)
    const reconstructed = job('promote', 'merge dest to main', { lastNote: WAITING_CHECKS })
    const retry = runPromote(reconstructed, [], { cwd: root, run })
    expect(retry).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    expect(argv.filter((row) => row[0] === 'git' && row[1] === 'push')).toHaveLength(1)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'merge')).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote retry without an open PR only reconciles remotes', () => {
    const root = join(tmpdir(), `automaton-land-reconcile-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    const result = runPromote(
      job('promote', 'merge dest to main', { lastNote: WAITING_CHECKS }),
      [],
      {
        cwd: root,
        run: (args) => {
          argv.push(args)
          if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
            return { status: 0, stdout: '[{"number":7,"state":"MERGED"}]', stderr: '' }
          }
          return remoteSha(args, false) ?? { status: 0, stdout: '', stderr: '' }
        },
      },
    )
    expect(result).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    expect(argv.some((row) => row[0] === 'git' && row[1] === 'push')).toBe(false)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote fails when required status checks failed', () => {
    const root = join(tmpdir(), `automaton-land-failed-checks-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          return { status: 1, stdout: '', stderr: 'failing required status checks' }
        }
        return remoteSha(args, false) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.waitingExternal).toBeUndefined()
    expect(result.spoken).toMatch(/failing required status checks/i)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote waits when required checks are pending', () => {
    const root = join(tmpdir(), `automaton-land-pending-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          return { status: 1, stdout: '', stderr: 'X required status checks are pending' }
        }
        return remoteSha(args, false) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: false, spoken: WAITING_CHECKS, waitingExternal: true })
    rmSync(root, { recursive: true, force: true })
  })

  test('promote fails on a non-CI operation in progress', () => {
    const root = join(tmpdir(), `automaton-land-in-progress-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          return { status: 1, stdout: '', stderr: 'operation in progress' }
        }
        return remoteSha(args, false) ?? { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.waitingExternal).toBeUndefined()
    expect(result.spoken).toMatch(/in progress/i)
    rmSync(root, { recursive: true, force: true })
  })

  test('promote fails on merge conflict and auth without waiting', () => {
    const root = join(tmpdir(), `automaton-land-fail-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const conflict = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          return { status: 1, stdout: '', stderr: 'not mergeable: merge conflict' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(conflict.ok).toBe(false)
    expect(conflict.waitingExternal).toBeUndefined()
    expect(conflict.spoken).toMatch(/conflict/i)
    const auth = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list') {
          return { status: 0, stdout: '[{"number":7,"state":"OPEN"}]', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'merge') {
          return { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(auth.ok).toBe(false)
    expect(auth.waitingExternal).toBeUndefined()
    expect(auth.waitingUser).toBe(true)
    expect(auth.source).toBe('host')
    expect(auth.spoken).toMatch(/403|accessible/i)
    rmSync(root, { recursive: true, force: true })
  })

  test('host auth is concrete phrases only; permission denied stays failed', () => {
    expect(isDefinitiveAuthDenial('HTTP 403: Resource not accessible by integration')).toBe(true)
    expect(isDefinitiveAuthDenial('Unauthorized')).toBe(true)
    expect(isDefinitiveAuthDenial('authentication failed')).toBe(true)
    expect(isDefinitiveAuthDenial('bad credentials')).toBe(true)
    expect(isDefinitiveAuthDenial('please run: gh auth login')).toBe(true)
    expect(isDefinitiveAuthDenial('not logged in')).toBe(true)
    expect(isDefinitiveAuthDenial('permission denied')).toBe(false)
    expect(isDefinitiveAuthDenial('authentication')).toBe(false)
    expect(isDefinitiveAuthDenial('authorization')).toBe(false)
    const root = join(tmpdir(), `automaton-land-perm-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const denied = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'git' && args[1] === 'push') {
          return { status: 1, stdout: '', stderr: 'fatal: permission denied' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(denied.ok).toBe(false)
    expect(denied.waitingUser).toBeUndefined()
    expect(denied.spoken).toMatch(/permission denied/i)
    rmSync(root, { recursive: true, force: true })
  })

  test('ship tags the package version', () => {
    const root = join(tmpdir(), `automaton-ship-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.360' }))
    const argv: string[][] = []
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'view') {
          return { status: 1, stdout: '', stderr: 'release not found' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'Shipped v0.9.360.' })
    expect(argv[0]).toEqual(['git', 'tag', 'v0.9.360'])
    expect(argv[1]).toEqual(['git', 'push', 'origin', 'v0.9.360'])
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'release' && row[2] === 'view')).toBe(true)
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'release' && row[2] === 'create')).toBe(true)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('ship without a checkout waits on the user', () => {
    const result = runShip(job('ship', 'ship a new release'), [], {
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })
    expect(result).toEqual({
      ok: false,
      spoken: 'Need a product checkout to ship.',
      waitingUser: true,
      source: 'staff',
    })
  })

  test('ship fails closed without a version', () => {
    const root = join(tmpdir(), `automaton-ship-none-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })
    expect(result.ok).toBe(false)
    expect(result.spoken).toBe('Need a version on dest before tagging.')
    rmSync(root, { recursive: true, force: true })
  })

  test('ship replay of an existing matching tag and release is success', () => {
    const root = join(tmpdir(), `automaton-ship-exists-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.360' }))
    const same = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const argv: string[][] = []
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'git' && args[1] === 'tag') {
          return { status: 1, stdout: '', stderr: "fatal: tag 'v0.9.360' already exists" }
        }
        if (args[0] === 'git' && args[1] === 'rev-parse') {
          return { status: 0, stdout: `${same}\n`, stderr: '' }
        }
        if (args[0] === 'git' && args[1] === 'push') {
          return { status: 1, stdout: '', stderr: 'error: already exists' }
        }
        if (args[0] === 'git' && args[1] === 'ls-remote') {
          return { status: 0, stdout: `${same}\trefs/tags/v0.9.360\n`, stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'view') {
          return { status: 0, stdout: '{"tagName":"v0.9.360"}', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'Shipped v0.9.360.' })
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'release' && row[2] === 'create')).toBe(false)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('ship fails when a remote tag already exists at a different commit', () => {
    const root = join(tmpdir(), `automaton-ship-conflict-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.360' }))
    const argv: string[][] = []
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'git' && args[1] === 'push') {
          return { status: 1, stdout: '', stderr: 'error: already exists' }
        }
        if (args[0] === 'git' && args[1] === 'rev-parse' && args[2] === 'HEAD') {
          return { status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' }
        }
        if (args[0] === 'git' && args[1] === 'ls-remote') {
          return {
            status: 0,
            stdout: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v0.9.360\n',
            stderr: '',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.spoken).toBe('Remote v0.9.360 points at a different commit.')
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'release')).toBe(false)
    expect(argv.some((row) => row.includes('--force'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('ship confirms an already-existing release by re-viewing the exact tag', () => {
    const root = join(tmpdir(), `automaton-ship-replay-view-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.360' }))
    const views: string[] = []
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'view') {
          views.push(String(args[3]))
          if (views.length === 1) return { status: 1, stdout: '', stderr: 'release not found' }
          return { status: 0, stdout: '{"tagName":"v0.9.360"}', stderr: '' }
        }
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'create') {
          return { status: 1, stdout: '', stderr: 'HTTP 422: Release already exists' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'Shipped v0.9.360.' })
    expect(views).toEqual(['v0.9.360', 'v0.9.360'])
    rmSync(root, { recursive: true, force: true })
  })

  test('ship fails when create says the release exists but re-view cannot confirm it', () => {
    const root = join(tmpdir(), `automaton-ship-unconfirmed-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.360' }))
    let views = 0
    const result = runShip(job('ship', 'ship a new release'), [], {
      cwd: root,
      run: (args) => {
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'view') {
          views += 1
          return { status: 1, stdout: '', stderr: 'release not found' }
        }
        if (args[0] === 'gh' && args[1] === 'release' && args[2] === 'create') {
          return { status: 1, stdout: '', stderr: 'HTTP 422: Release already exists' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result.ok).toBe(false)
    expect(result.spoken).toMatch(/already exists/i)
    expect(views).toBe(2)
    rmSync(root, { recursive: true, force: true })
  })
})
