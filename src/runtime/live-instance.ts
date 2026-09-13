import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

export type LiveInstanceSeams = {
  /** Raw process list: one line per process, `pid` then command (space-separated). */
  listPs?: () => string
  /** Return true if the signal was delivered; false if denied. */
  kill?: (pid: number, signal: NodeJS.Signals) => boolean
  /** Pids still alive after a signal wave (subset of the asked list). */
  stillAlive?: (pids: number[]) => number[]
  nowPid?: () => number
  repoRoot?: string
}

export type ReclaimResult = {
  cleared: number[]
  failed: number[]
  note?: string
}

/** Path fragments that identify this install’s Automaton / bun face processes. */
export function automatonProcessMatchers(repoRoot: string): string[] {
  const root = resolve(repoRoot)
  return [join(root, 'macos', 'Automaton.app'), join(root, 'src', 'main.tsx')]
}

function defaultListPs(): string {
  const result = spawnSync('ps', ['-ax', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5_000,
    env: process.env,
  })
  if (result.status !== 0) return ''
  return result.stdout ?? ''
}

function defaultKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

function parsePsLines(text: string): Array<{ pid: number; command: string }> {
  const rows: Array<{ pid: number; command: string }> = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = /^(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const pid = Number.parseInt(match[1]!, 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    rows.push({ pid, command: match[2]! })
  }
  return rows
}

function matchesInstall(command: string, matchers: string[]): boolean {
  for (const needle of matchers) {
    if (needle && command.includes(needle)) return true
  }
  return false
}

export function listAutomatonPids(seams: LiveInstanceSeams = {}): number[] {
  const root = seams.repoRoot ?? process.cwd()
  const matchers = automatonProcessMatchers(root)
  const text = (seams.listPs ?? defaultListPs)()
  const seen = new Set<number>()
  for (const row of parsePsLines(text)) {
    if (!matchesInstall(row.command, matchers)) continue
    seen.add(row.pid)
  }
  return [...seen].sort((a, b) => a - b)
}

function aliveAmong(pids: number[], seams: LiveInstanceSeams): number[] {
  if (seams.stillAlive) return seams.stillAlive(pids)
  const live = new Set(listAutomatonPids(seams))
  return pids.filter((pid) => live.has(pid))
}

/**
 * Quit/kill prior Automaton windows for this install before opening a new face.
 * Never kills keepPid (or the current process). Fail soft when kill is denied.
 */
export function reclaimAutomatonZombies(opts: {
  keepPid?: number
  seams?: LiveInstanceSeams
} = {}): ReclaimResult {
  const seams = opts.seams ?? {}
  const self = opts.keepPid ?? seams.nowPid?.() ?? process.pid
  const kill = seams.kill ?? defaultKill
  const targets = listAutomatonPids(seams).filter((pid) => pid !== self)
  if (targets.length === 0) return { cleared: [], failed: [] }

  const denied = new Set<number>()
  for (const pid of targets) {
    if (!kill(pid, 'SIGTERM')) denied.add(pid)
  }

  let survivors = aliveAmong(
    targets.filter((pid) => !denied.has(pid)),
    seams,
  )
  for (const pid of survivors) {
    if (!kill(pid, 'SIGKILL')) denied.add(pid)
  }

  survivors = aliveAmong(
    targets.filter((pid) => !denied.has(pid)),
    seams,
  )
  for (const pid of survivors) denied.add(pid)

  const cleared = targets.filter((pid) => !denied.has(pid))
  const failed = [...denied].sort((a, b) => a - b)
  return { cleared, failed, note: reclaimNote(cleared, failed) }
}

export function reclaimNote(cleared: number[], failed: number[]): string | undefined {
  if (cleared.length === 0 && failed.length === 0) return undefined
  if (cleared.length > 0 && failed.length === 0) {
    return cleared.length === 1
      ? 'Cleared stale window…'
      : `Cleared ${cleared.length} stale windows…`
  }
  if (cleared.length === 0) {
    return (
      `Could not quit leftover Automaton process(es) (${failed.join(', ')}). ` +
      `Quit them and run bun run app.`
    )
  }
  return (
    `Cleared stale window… (${failed.length} still running — quit leftovers, then bun run app).`
  )
}

/**
 * After reclaim, open without `-n` so LaunchServices can focus an existing
 * instance if any survive; only force a new instance when AUTOMATON_OPEN_NEW=1.
 */
export function preferSingleInstanceOpen(env: NodeJS.ProcessEnv = process.env): {
  forceNew: boolean
  openArgs: (app: string) => string[]
} {
  const forceNew = env.AUTOMATON_OPEN_NEW === '1'
  return {
    forceNew,
    openArgs: (app) => (forceNew ? ['-n', app] : [app]),
  }
}

export type LiveInstanceDoctor = {
  status: 'ok' | 'warn'
  pids: number[]
  message?: string
}

/** Doctor WARN when zombie / hot leftovers are still up for this install. */
export function doctorLiveInstance(seams: LiveInstanceSeams = {}): LiveInstanceDoctor {
  const self = seams.nowPid?.() ?? process.pid
  const pids = listAutomatonPids(seams).filter((pid) => pid !== self)
  if (pids.length === 0) return { status: 'ok', pids: [] }
  return {
    status: 'warn',
    pids,
    message:
      `Leftover Automaton process(es) still running (${pids.join(', ')}). ` +
      `Quit them and kick cold with bun run app (dev --hot is opt-in and can leave zombies).`,
  }
}
