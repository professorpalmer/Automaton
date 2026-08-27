import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { JobHandle } from '../domain'
import { sandboxDir } from './pm'

export type LandRun = (argv: string[], cwd: string) => { status: number; stdout: string; stderr: string }

export type LandSeams = {
  run?: LandRun
  cwd?: string
}

function exec(argv: string[], cwd: string, seams: LandSeams): { status: number; stdout: string; stderr: string } {
  if (seams.run) return seams.run(argv, cwd)
  const result = spawnSync(argv[0] ?? 'git', argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export function landCwd(job: JobHandle, known: JobHandle[], seams: LandSeams): string | null {
  for (let i = known.length - 1; i >= 0; i -= 1) {
    const prior = known[i]
    if (prior.ownerAgentId !== job.ownerAgentId || prior.kind !== 'implement' || prior.status !== 'complete') {
      continue
    }
    const root = sandboxDir(prior.id)
    if (existsSync(join(root, '.git'))) return root
  }
  if (seams.cwd && existsSync(join(seams.cwd, '.git'))) return seams.cwd
  return null
}

function spokenFail(stderr: string, fallback: string): string {
  const line = stderr.trim().split('\n').find((row) => row.trim().length > 0)
  return line && line.length < 180 ? line : fallback
}

function openPrNumber(cwd: string, seams: LandSeams): string {
  const listed = exec(
    ['gh', 'pr', 'list', '--base', 'main', '--head', 'dev', '--json', 'number', '--jq', '.[0].number'],
    cwd,
    seams,
  )
  return listed.status === 0 ? listed.stdout.trim() : ''
}

/** Push dest and merge dest into main. Never force-push. */
export function runPromote(
  job: JobHandle,
  known: JobHandle[] = [],
  seams: LandSeams = {},
): { ok: boolean; spoken: string } {
  const cwd = landCwd(job, known, seams)
  if (!cwd) return { ok: false, spoken: 'Need a product checkout to land dest.' }
  const push = exec(['git', 'push', '-u', 'origin', 'HEAD:dev'], cwd, seams)
  if (push.status !== 0) {
    return { ok: false, spoken: spokenFail(push.stderr || push.stdout, "Couldn't push dest.") }
  }
  let number = openPrNumber(cwd, seams)
  if (!number) {
    const opened = exec(
      ['gh', 'pr', 'create', '--base', 'main', '--head', 'dev', '--title', job.goal.slice(0, 72), '--body', job.goal],
      cwd,
      seams,
    )
    if (opened.status !== 0) {
      return { ok: false, spoken: spokenFail(opened.stderr || opened.stdout, "Couldn't open dest into main.") }
    }
    number = openPrNumber(cwd, seams)
  }
  if (!number) return { ok: false, spoken: "Couldn't find dest into main." }
  const merged = exec(['gh', 'pr', 'merge', number, '--merge'], cwd, seams)
  if (merged.status !== 0) {
    return { ok: false, spoken: spokenFail(merged.stderr || merged.stdout, "Couldn't merge dest into main.") }
  }
  return { ok: true, spoken: 'dev and main are equal.' }
}

function readVersion(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
  } catch {
    return null
  }
  return null
}

/** Tag the version already on dest/main. Does not bump. Fail closed without a version. */
export function runShip(
  job: JobHandle,
  known: JobHandle[] = [],
  seams: LandSeams = {},
): { ok: boolean; spoken: string } {
  const cwd = landCwd(job, known, seams)
  if (!cwd) return { ok: false, spoken: 'Need a product checkout to ship.' }
  const version = readVersion(cwd)
  if (!version) return { ok: false, spoken: 'Need a version on dest before tagging.' }
  const tag = version.startsWith('v') ? version : `v${version}`
  const tagged = exec(['git', 'tag', tag], cwd, seams)
  if (tagged.status !== 0 && !/already exists/.test(`${tagged.stderr}${tagged.stdout}`)) {
    return { ok: false, spoken: spokenFail(tagged.stderr || tagged.stdout, `Couldn't tag ${tag}.`) }
  }
  const pushed = exec(['git', 'push', 'origin', tag], cwd, seams)
  if (pushed.status !== 0) {
    return { ok: false, spoken: spokenFail(pushed.stderr || pushed.stdout, `Couldn't push ${tag}.`) }
  }
  const released = exec(['gh', 'release', 'create', tag, '--generate-notes'], cwd, seams)
  if (released.status !== 0 && !/already exists/.test(`${released.stderr}${released.stdout}`)) {
    return { ok: false, spoken: spokenFail(released.stderr || released.stdout, `Couldn't publish ${tag}.`) }
  }
  return { ok: true, spoken: `Shipped ${tag}.` }
}
