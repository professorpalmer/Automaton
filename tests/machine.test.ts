import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatWellKnown,
  listMachineProjects,
  listWellKnownProjects,
  matchMachineProject,
} from '../src/runtime/machine.ts'

function gitDir(root: string, folder: string): string {
  const path = join(root, folder)
  mkdirSync(path, { recursive: true })
  const init = spawnSync('git', ['init'], { cwd: path, encoding: 'utf8' })
  expect(init.status).toBe(0)
  return path
}

describe('machine checkouts', () => {
  test('lists git trees and matches the named product, not a worktree sibling', () => {
    const root = join(tmpdir(), `automaton-projects-${Date.now()}`)
    const pm = gitDir(root, 'Puppetmaster')
    const wt = gitDir(root, 'marionette-wt-318')
    const marionette = gitDir(root, 'marionette')
    mkdirSync(join(root, 'notes'), { recursive: true })
    writeFileSync(join(root, 'notes', 'readme.txt'), 'not a repo')
    const projects = listMachineProjects(root)
    expect(projects.map((row) => row.path).sort()).toEqual([marionette, wt, pm].sort())
    expect(matchMachineProject('what script does puppetmaster have', projects)?.path).toBe(pm)
    expect(matchMachineProject('what about Marionette onboarding', projects)?.path).toBe(marionette)
    expect(matchMachineProject('hello there', projects)).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })

  test('well-known labels skip unknown folders', () => {
    const root = join(tmpdir(), `automaton-known-${Date.now()}`)
    gitDir(root, 'Puppetmaster')
    gitDir(root, 'ToyVendor')
    const known = listWellKnownProjects(root)
    expect(known.map((row) => row.name)).toEqual(['Puppetmaster'])
    expect(formatWellKnown(known)).toContain('Puppetmaster at')
    rmSync(root, { recursive: true, force: true })
  })
})
