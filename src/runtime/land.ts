import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { WAITING_CHECKS, type JobHandle } from '../domain'
import { sandboxDir } from './pm'

export type LandRun = (argv: string[], cwd: string) => { status: number; stdout: string; stderr: string }

export type HostResult = {
  ok: boolean
  spoken: string
  waitingExternal?: boolean
}

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
    if (job.goalId && prior.goalId !== job.goalId) continue
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

type DestPr = { number: number; state: string }

function destPrs(cwd: string, seams: LandSeams): DestPr[] {
  const listed = exec(
    ['gh', 'pr', 'list', '--base', 'main', '--head', 'dev', '--state', 'all', '--json', 'number,state'],
    cwd,
    seams,
  )
  if (listed.status !== 0) return []
  try {
    const rows = JSON.parse(listed.stdout) as unknown
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const rec = row as { number?: unknown; state?: unknown }
      const number = Number(rec.number)
      const state = typeof rec.state === 'string' ? rec.state : ''
      if (!Number.isFinite(number) || number < 1) return []
      return [{ number, state }]
    })
  } catch {
    return []
  }
}

function alreadyMerged(stderr: string, stdout: string): boolean {
  return /already merged|pull request is merged|not mergeable:\s*already/i.test(`${stderr}\n${stdout}`)
}

function mergeBlocked(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`
  if (/required reviews?|changes requested|review required/i.test(text)) return true
  if (/unauthoriz|authentication|auth fail|http\s*40[13]|permission denied|resource not accessible/i.test(text)) {
    return true
  }
  if (/merge conflict|conflicting files|not mergeable:\s*(dirty|conflicts?)/i.test(text)) return true
  if (/protected branch|branch protection|\bpolicy\b/i.test(text)) return true
  if (
    /\bfail(?:ed|ing)\b.{0,48}required (?:status )?checks?\b/i.test(text) ||
    /required (?:status )?checks?.{0,48}\bfail/i.test(text) ||
    /\bchecks? failed\b/i.test(text)
  ) {
    return true
  }
  return false
}

function mergePending(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`
  if (/merge queue|auto[- ]?merge|queued for merge/i.test(text)) return true
  if (/not mergeable:\s*(blocked|behind|unstable)/i.test(text)) return true
  if (/waiting for .{0,40}(check|ci|status)/i.test(text)) return true
  if (/(?:required (?:status )?checks?|checks?) (?:are )?(pending|queued|in progress)/i.test(text)) {
    return true
  }
  if (/pending .{0,40}checks?/i.test(text)) return true
  if (/(check|checks|ci|status).{0,40}in progress/i.test(text)) return true
  return false
}

function alreadyWaitingExternal(job: Pick<JobHandle, 'lastNote'>): boolean {
  return job.lastNote === WAITING_CHECKS
}

function waitingExternal(): HostResult {
  return { ok: false, spoken: WAITING_CHECKS, waitingExternal: true }
}

function afterMerge(
  cwd: string,
  seams: LandSeams,
  result: { status: number; stdout: string; stderr: string },
): HostResult {
  if (result.status !== 0 && !alreadyMerged(result.stderr, result.stdout) && mergeBlocked(result.stderr, result.stdout)) {
    return { ok: false, spoken: spokenFail(result.stderr || result.stdout, "Couldn't merge dest into main.") }
  }
  if (remotesEqual(cwd, seams)) return { ok: true, spoken: 'dev and main are equal.' }
  if (result.status === 0 || alreadyMerged(result.stderr, result.stdout) || mergePending(result.stderr, result.stdout)) {
    return waitingExternal()
  }
  return { ok: false, spoken: spokenFail(result.stderr || result.stdout, "Couldn't merge dest into main.") }
}

function gitSha(stdout: string): string {
  const sha = stdout.trim().split(/\s+/)[0] ?? ''
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : ''
}

function revParse(cwd: string, ref: string, seams: LandSeams): string {
  const result = exec(['git', 'rev-parse', ref], cwd, seams)
  return result.status === 0 ? gitSha(result.stdout) : ''
}

function remotesEqual(cwd: string, seams: LandSeams): boolean {
  const fetched = exec(['git', 'fetch', 'origin', 'dev', 'main'], cwd, seams)
  if (fetched.status !== 0) return false
  const dest = revParse(cwd, 'origin/dev', seams)
  const main = revParse(cwd, 'origin/main', seams)
  return Boolean(dest && main && dest === main)
}

function currentDestPr(cwd: string, seams: LandSeams): number | undefined {
  return destPrs(cwd, seams).find((row) => /open/i.test(row.state))?.number
}

/** Push dest and merge dest into main. Never force-push. Equality is current remotes, not an old PR. */
export function runPromote(
  job: JobHandle,
  known: JobHandle[] = [],
  seams: LandSeams = {},
): HostResult {
  const cwd = landCwd(job, known, seams)
  if (!cwd) return { ok: false, spoken: 'Need a product checkout to land dest.' }
  const waiting = alreadyWaitingExternal(job)
  if (!waiting) {
    const push = exec(['git', 'push', '-u', 'origin', 'HEAD:dev'], cwd, seams)
    if (push.status !== 0) {
      return { ok: false, spoken: spokenFail(push.stderr || push.stdout, "Couldn't push dest.") }
    }
  }
  let number = currentDestPr(cwd, seams)
  if (!number) {
    if (remotesEqual(cwd, seams)) return { ok: true, spoken: 'dev and main are equal.' }
    if (waiting) return waitingExternal()
    const opened = exec(
      ['gh', 'pr', 'create', '--base', 'main', '--head', 'dev', '--title', job.goal.slice(0, 72), '--body', job.goal],
      cwd,
      seams,
    )
    if (opened.status !== 0 && !/already exists/i.test(`${opened.stderr}${opened.stdout}`)) {
      return { ok: false, spoken: spokenFail(opened.stderr || opened.stdout, "Couldn't open dest into main.") }
    }
    number = currentDestPr(cwd, seams)
    if (!number && remotesEqual(cwd, seams)) return { ok: true, spoken: 'dev and main are equal.' }
    if (!number) return waitingExternal()
  }
  return afterMerge(cwd, seams, exec(['gh', 'pr', 'merge', String(number), '--merge'], cwd, seams))
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
): HostResult {
  const cwd = landCwd(job, known, seams)
  if (!cwd) return { ok: false, spoken: 'Need a product checkout to ship.' }
  const version = readVersion(cwd)
  if (!version) return { ok: false, spoken: 'Need a version on dest before tagging.' }
  const tag = version.startsWith('v') ? version : `v${version}`
  const tagged = exec(['git', 'tag', tag], cwd, seams)
  if (tagged.status !== 0) {
    if (!/already exists/.test(`${tagged.stderr}${tagged.stdout}`)) {
      return { ok: false, spoken: spokenFail(tagged.stderr || tagged.stdout, `Couldn't tag ${tag}.`) }
    }
    if (!tagMatchesHead(cwd, tag, seams)) {
      return { ok: false, spoken: `${tag} already points at a different commit.` }
    }
  }
  const pushed = exec(['git', 'push', 'origin', tag], cwd, seams)
  if (pushed.status !== 0) {
    if (!/already exists/.test(`${pushed.stderr}${pushed.stdout}`)) {
      return { ok: false, spoken: spokenFail(pushed.stderr || pushed.stdout, `Couldn't push ${tag}.`) }
    }
    if (!remoteTagMatchesHead(cwd, tag, seams)) {
      return { ok: false, spoken: `Remote ${tag} points at a different commit.` }
    }
  }
  const viewed = exec(['gh', 'release', 'view', tag, '--json', 'tagName'], cwd, seams)
  if (viewed.status === 0) return { ok: true, spoken: `Shipped ${tag}.` }
  const released = exec(['gh', 'release', 'create', tag, '--generate-notes'], cwd, seams)
  if (released.status === 0) return { ok: true, spoken: `Shipped ${tag}.` }
  if (/already exists/i.test(`${released.stderr}${released.stdout}`)) {
    const confirmed = exec(['gh', 'release', 'view', tag, '--json', 'tagName'], cwd, seams)
    if (confirmed.status === 0) return { ok: true, spoken: `Shipped ${tag}.` }
  }
  return { ok: false, spoken: spokenFail(released.stderr || released.stdout, `Couldn't publish ${tag}.`) }
}

function tagMatchesHead(cwd: string, tag: string, seams: LandSeams): boolean {
  const head = revParse(cwd, 'HEAD', seams)
  const existing = revParse(cwd, `${tag}^{commit}`, seams)
  return Boolean(head && existing && head === existing)
}

function remoteTagMatchesHead(cwd: string, tag: string, seams: LandSeams): boolean {
  const head = revParse(cwd, 'HEAD', seams)
  const listed = exec(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`], cwd, seams)
  if (listed.status !== 0 || !head) return false
  const lines = listed.stdout.split('\n')
  const peeled = lines.find((row) => row.includes('^{}'))
  const remote = gitSha(peeled ?? lines.find((row) => row.trim()) ?? '')
  return Boolean(remote && remote === head)
}
