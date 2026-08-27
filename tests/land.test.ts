import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHandle } from '../src/domain'
import { runPromote, runShip } from '../src/runtime/land.ts'

function job(kind: JobHandle['kind'], goal: string): JobHandle {
  return {
    id: 'job_land',
    ownerAgentId: 'agent_m',
    goal,
    status: 'running',
    kind,
  }
}

describe('host land', () => {
  test('promote pushes dest, opens dest into main when missing, then merges', () => {
    const root = join(tmpdir(), `automaton-land-${Date.now()}`)
    mkdirSync(join(root, '.git'), { recursive: true })
    const argv: string[][] = []
    let listed = 0
    const result = runPromote(job('promote', 'merge dest to main'), [], {
      cwd: root,
      run: (args) => {
        argv.push(args)
        if (args[0] === 'gh' && args[1] === 'pr' && args[2] === 'list' && args.includes('--jq')) {
          listed += 1
          return { status: 0, stdout: listed === 1 ? '' : '4', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'dev and main are equal.' })
    expect(argv[0]).toEqual(['git', 'push', '-u', 'origin', 'HEAD:dev'])
    expect(argv.some((row) => row[0] === 'gh' && row[1] === 'pr' && row[2] === 'create')).toBe(true)
    expect(argv.at(-1)).toEqual(['gh', 'pr', 'merge', '4', '--merge'])
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
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, spoken: 'Shipped v0.9.360.' })
    expect(argv[0]).toEqual(['git', 'tag', 'v0.9.360'])
    expect(argv[1]).toEqual(['git', 'push', 'origin', 'v0.9.360'])
    expect(argv[2]?.slice(0, 3)).toEqual(['gh', 'release', 'create'])
    rmSync(root, { recursive: true, force: true })
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
})
