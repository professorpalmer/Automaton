import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  applyUpdate,
  checkForUpdate,
  dismissUpdate,
  readDismissedSha,
  shouldOfferUpdate,
  type UpdateRun,
} from '../src/runtime/updates'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-update-${Date.now()}-${Math.random()}`)
  mkdirSync(join(home, '.git'), { recursive: true })
  return home
}

function script(map: Record<string, { status?: number; stdout?: string; stderr?: string }>): UpdateRun {
  return (argv) => {
    const key = argv.join(' ')
    const hit = map[key]
    if (!hit) return { status: 1, stdout: '', stderr: `unexpected ${key}` }
    return { status: hit.status ?? 0, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' }
  }
}

describe('update check', () => {
  test('offers when origin/main is ahead and not dismissed', () => {
    const home = tmpHome()
    const run = script({
      'git fetch --quiet origin main': {},
      'git rev-parse HEAD': { stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' },
      'git rev-parse origin/main': { stdout: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' },
      'git rev-list --count HEAD..origin/main': { stdout: '2\n' },
      'git status --porcelain': { stdout: '' },
    })
    const offer = checkForUpdate({ run, cwd: home, home })
    expect(offer?.behind).toBe(2)
    expect(offer?.latest.startsWith('bbbb')).toBe(true)
    expect(shouldOfferUpdate(offer, '')).toBe(true)
    dismissUpdate(offer!.latest, home)
    expect(readDismissedSha(home)).toBe(offer!.latest)
    expect(shouldOfferUpdate(offer, readDismissedSha(home))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  test('stays quiet when already even', () => {
    const home = tmpHome()
    const run = script({
      'git fetch --quiet origin main': {},
      'git rev-parse HEAD': { stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' },
      'git rev-parse origin/main': { stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' },
      'git rev-list --count HEAD..origin/main': { stdout: '0\n' },
      'git status --porcelain': { stdout: '' },
    })
    expect(checkForUpdate({ run, cwd: home, home })).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })

  test('apply refuses a dirty tree and fast-forwards a clean one', () => {
    const home = tmpHome()
    const dirty = script({
      'git status --porcelain': { stdout: ' M src/app.tsx\n' },
    })
    expect(applyUpdate({ run: dirty, cwd: home }).ok).toBe(false)
    const clean = script({
      'git status --porcelain': { stdout: '' },
      'git fetch --quiet origin main': {},
      'git merge --ff-only origin/main': {},
    })
    expect(applyUpdate({ run: clean, cwd: home })).toEqual({ ok: true, spoken: 'Updated.' })
    rmSync(home, { recursive: true, force: true })
  })
})
