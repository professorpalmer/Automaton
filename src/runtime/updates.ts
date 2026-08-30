import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { automatonHome } from './keys'
import { runningTests } from './test-env'

export type UpdateOffer = {
  current: string
  latest: string
  behind: number
  dirty: boolean
}

export type UpdateResult = { ok: boolean; spoken: string }

export type UpdateRun = (argv: string[], cwd: string) => { status: number; stdout: string; stderr: string }

export type UpdateSeams = {
  run?: UpdateRun
  cwd?: string
  home?: string
}

const REMOTE_MAIN = 'origin/main'

function exec(argv: string[], cwd: string, seams: UpdateSeams, timeout = 20_000) {
  if (seams.run) return seams.run(argv, cwd)
  const result = spawnSync(argv[0] ?? 'git', argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout,
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

export function updateRoot(seams: UpdateSeams = {}): string {
  return seams.cwd ?? process.cwd()
}

export function updateStatePath(home = automatonHome()): string {
  return join(home, 'update.json')
}

export function readDismissedSha(home = automatonHome()): string {
  const path = updateStatePath(home)
  if (!existsSync(path)) return ''
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { dismissed?: unknown }
    return typeof raw.dismissed === 'string' ? raw.dismissed.trim() : ''
  } catch {
    return ''
  }
}

export function dismissUpdate(sha: string, home = automatonHome()): void {
  const tip = sha.trim()
  if (!tip) return
  mkdirSync(home, { recursive: true })
  writeFileSync(updateStatePath(home), `${JSON.stringify({ dismissed: tip }, null, 2)}\n`)
}

export function shouldOfferUpdate(offer: UpdateOffer | null, dismissed = ''): boolean {
  if (!offer || offer.behind < 1) return false
  return offer.latest !== dismissed.trim()
}

function shaOf(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return /^[0-9a-f]{7,40}$/i.test(line) ? line.toLowerCase() : ''
}

export function checkForUpdate(seams: UpdateSeams = {}): UpdateOffer | null {
  const cwd = updateRoot(seams)
  if (!existsSync(join(cwd, '.git'))) return null
  const fetched = exec(['git', 'fetch', '--quiet', 'origin', 'main'], cwd, seams)
  if (fetched.status !== 0) return null
  const head = shaOf(exec(['git', 'rev-parse', 'HEAD'], cwd, seams).stdout)
  const latest = shaOf(exec(['git', 'rev-parse', REMOTE_MAIN], cwd, seams).stdout)
  if (!head || !latest) return null
  const counted = exec(['git', 'rev-list', '--count', `HEAD..${REMOTE_MAIN}`], cwd, seams)
  const behind = Number.parseInt(counted.stdout.trim(), 10)
  if (!Number.isFinite(behind) || behind < 1) return null
  const porcelain = exec(['git', 'status', '--porcelain'], cwd, seams)
  return {
    current: head,
    latest,
    behind,
    dirty: porcelain.stdout.trim().length > 0,
  }
}

export function applyUpdate(seams: UpdateSeams = {}): UpdateResult {
  const cwd = updateRoot(seams)
  if (!existsSync(join(cwd, '.git'))) return { ok: false, spoken: 'Not a git checkout.' }
  const porcelain = exec(['git', 'status', '--porcelain'], cwd, seams)
  if (porcelain.stdout.trim()) {
    return { ok: false, spoken: 'Local changes are in the way. Commit or stash first.' }
  }
  const fetched = exec(['git', 'fetch', '--quiet', 'origin', 'main'], cwd, seams)
  if (fetched.status !== 0) return { ok: false, spoken: 'Could not reach origin.' }
  const merged = exec(['git', 'merge', '--ff-only', REMOTE_MAIN], cwd, seams)
  if (merged.status !== 0) {
    return { ok: false, spoken: 'Could not fast-forward onto main.' }
  }
  return { ok: true, spoken: 'Updated.' }
}

/** Open a new Automaton, then quit this process. Tests no-op. */
export function relaunchAutomaton(cwd = process.cwd()): void {
  if (runningTests()) return
  if (process.platform === 'darwin') {
    spawn('bun', ['run', 'app'], { cwd, detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn(process.execPath, [join(cwd, 'src/main.tsx')], { cwd, detached: true, stdio: 'ignore' }).unref()
  }
  process.exit(0)
}
