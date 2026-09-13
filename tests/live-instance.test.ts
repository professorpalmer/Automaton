import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  automatonProcessMatchers,
  doctorLiveInstance,
  listAutomatonPids,
  preferSingleInstanceOpen,
  reclaimAutomatonZombies,
  reclaimNote,
  type LiveInstanceSeams,
} from '../src/runtime/live-instance'

const repo = '/Users/cary/Projects/Automaton'

function psLines(rows: Array<{ pid: number; command: string }>): string {
  return rows.map((row) => `${row.pid} ${row.command}`).join('\n')
}

describe('automatonProcessMatchers', () => {
  test('includes this install app bundle and main.tsx', () => {
    const matchers = automatonProcessMatchers(repo)
    expect(matchers).toContain(join(repo, 'macos', 'Automaton.app'))
    expect(matchers).toContain(join(repo, 'src', 'main.tsx'))
  })
})

describe('listAutomatonPids', () => {
  test('detects app stub, bundled runtime main, and bun --hot main under repo', () => {
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      listPs: () =>
        psLines([
          { pid: 10, command: '/usr/bin/zsh' },
          {
            pid: 100,
            command: `${join(repo, 'macos', 'Automaton.app')}/Contents/MacOS/Automaton`,
          },
          {
            pid: 101,
            command: `${join(repo, 'macos', 'Automaton.app')}/Contents/MacOS/runtime ${join(repo, 'src', 'main.tsx')}`,
          },
          {
            pid: 102,
            command: `bun --hot ${join(repo, 'src', 'main.tsx')}`,
          },
          { pid: 103, command: 'bun --hot /other/src/main.tsx' },
          { pid: 104, command: `bun ${join(repo, 'src', 'main.tsx')}` },
        ]),
    }
    expect(listAutomatonPids(seams)).toEqual([100, 101, 102, 104])
  })

  test('empty list is a no-op for reclaim', () => {
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      listPs: () => psLines([{ pid: 1, command: '/bin/zsh' }]),
      kill: () => {
        throw new Error('should not kill')
      },
    }
    expect(reclaimAutomatonZombies({ keepPid: 999, seams })).toEqual({
      cleared: [],
      failed: [],
    })
  })
})

describe('reclaimAutomatonZombies', () => {
  test('kills orphans and keeps keepPid', () => {
    const signals: Array<{ pid: number; signal: string }> = []
    let alive = new Set([200, 201, 202])
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      listPs: () =>
        psLines(
          [...alive].map((pid) => ({
            pid,
            command: `bun ${join(repo, 'src', 'main.tsx')}`,
          })),
        ),
      kill: (pid, signal) => {
        signals.push({ pid, signal })
        if (signal === 'SIGTERM' || signal === 'SIGKILL') alive.delete(pid)
        return true
      },
      stillAlive: (pids) => pids.filter((pid) => alive.has(pid)),
    }
    const result = reclaimAutomatonZombies({ keepPid: 201, seams })
    expect(result.cleared.sort((a, b) => a - b)).toEqual([200, 202])
    expect(result.failed).toEqual([])
    expect(result.note).toBe('Cleared 2 stale windows…')
    expect(signals.every((row) => row.pid !== 201)).toBe(true)
    expect(alive.has(201)).toBe(true)
  })

  test('fail soft when kill denied', () => {
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      listPs: () =>
        psLines([
          { pid: 300, command: `bun ${join(repo, 'src', 'main.tsx')}` },
          { pid: 301, command: `bun ${join(repo, 'src', 'main.tsx')}` },
        ]),
      kill: (pid) => pid !== 300,
      stillAlive: (pids) => pids.filter((pid) => pid === 300),
    }
    const result = reclaimAutomatonZombies({ keepPid: 1, seams })
    expect(result.failed).toEqual([300])
    expect(result.cleared).toEqual([301])
    expect(result.note).toContain('Cleared stale window')
    expect(result.note).toContain('bun run app')
  })

  test('all denied yields spoken doctor-style note', () => {
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      listPs: () =>
        psLines([{ pid: 400, command: `${join(repo, 'macos', 'Automaton.app')}/Contents/MacOS/Automaton` }]),
      kill: () => false,
      stillAlive: (pids) => pids,
    }
    const result = reclaimAutomatonZombies({ keepPid: 1, seams })
    expect(result.cleared).toEqual([])
    expect(result.failed).toEqual([400])
    expect(result.note).toContain('Could not quit leftover')
  })
})

describe('preferSingleInstanceOpen', () => {
  test('default open args omit -n; AUTOMATON_OPEN_NEW=1 forces new', () => {
    expect(preferSingleInstanceOpen({}).openArgs('/tmp/Automaton.app')).toEqual([
      '/tmp/Automaton.app',
    ])
    expect(preferSingleInstanceOpen({ AUTOMATON_OPEN_NEW: '1' }).forceNew).toBe(true)
    expect(preferSingleInstanceOpen({ AUTOMATON_OPEN_NEW: '1' }).openArgs('/tmp/A.app')).toEqual([
      '-n',
      '/tmp/A.app',
    ])
  })
})

describe('doctorLiveInstance', () => {
  test('warns when leftovers remain', () => {
    const seams: LiveInstanceSeams = {
      repoRoot: repo,
      nowPid: () => 1,
      listPs: () =>
        psLines([{ pid: 500, command: `bun --hot ${join(repo, 'src', 'main.tsx')}` }]),
    }
    const report = doctorLiveInstance(seams)
    expect(report.status).toBe('warn')
    expect(report.pids).toEqual([500])
    expect(report.message).toContain('bun run app')
  })

  test('ok when none', () => {
    expect(
      doctorLiveInstance({
        repoRoot: repo,
        nowPid: () => 1,
        listPs: () => '',
      }).status,
    ).toBe('ok')
  })
})

describe('reclaimNote', () => {
  test('single clear is brief honesty', () => {
    expect(reclaimNote([1], [])).toBe('Cleared stale window…')
  })
})
