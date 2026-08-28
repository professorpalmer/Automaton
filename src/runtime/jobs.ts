import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  WAITING_CHECKS,
  boundGoalEvidence,
  keepAliveStatus,
  type GoalBlockerSource,
  type JobHandle,
} from '../domain'
import { automatonHome, listOpenRouterKeys } from './keys'
import { type BoxSeams } from './box'
import { runBoxShell } from './box-shell'
import { isDefinitiveAuthDenial, runPromote, runShip, type HostResult, type LandSeams } from './land'
import { listMachineProjects, matchMachineProject } from './machine'
import { readProfile } from './profile'
import {
  PRODUCT_ROOT,
  analysisInstruction,
  analyzeCwd,
  analyzePrompt,
  buildAnalyzeArgv,
  implementInstruction,
  jobOutcome,
  killProcessGroup,
  ownerLabel,
  readArtifactRefs,
  readStatus,
  seedSandboxFromProduct,
  spawnPm,
  substantiveSpokenFromRefs,
  waitForJobId,
  writeAnalyzeConfig,
  writeImplementConfig,
  type SpawnedPm,
  type StatusSnap,
} from './pm'

export type DispatchHooks = {
  onAttached: (pmJobId: string) => void
  onStatus?: (spoken: string) => void
  onComplete: (spoken: string) => void
  onFail: (spoken: string) => void
  onWaitingExternal?: (spoken: string) => void
  onWaitingUser?: (spoken: string, source: GoalBlockerSource) => void
}

export type AnalyzeReuseHit = {
  pmJobId: string
  spoken: string
}

export const WATCH_UNAVAILABLE_GRACE = 3
export const STATUS_FIRST_DELAY_MS = 1500
export const STATUS_THROTTLE_MS = 15_000
export const EXTERNAL_WAIT_MS = 30_000
const WATCH_POLL_MS = 1500

export type DispatchSeams = {
  readStatus?: (pmJobId: string) => StatusSnap
  readArtifactRefs?: (pmJobId: string) => unknown
  spawn?: (argv: string[]) => Promise<SpawnedPm>
  analyzeFiles?: (job: JobHandle) => { configPath: string; goalPath: string }
  implementFiles?: (job: JobHandle) => { configPath: string; goalPath: string }
  sleep?: (ms: number) => Promise<void>
  maxUnavailableStatusReads?: number
  box?: BoxSeams
  boxShell?: (
    job: JobHandle,
  ) => { ok: boolean; spoken: string } | Promise<{ ok: boolean; spoken: string }>
  land?: LandSeams
  promote?: (job: JobHandle) => HostResult | Promise<HostResult>
  ship?: (job: JobHandle) => HostResult | Promise<HostResult>
  externalWaitMs?: number
}

type Inflight = {
  pid?: number
  abandoned: boolean
}

type StatusReader = (pmJobId: string) => StatusSnap
type RefsReader = (pmJobId: string) => unknown

const started = new Set<string>()
const inflight = new Map<string, Inflight>()
const cancelled = new Set<string>()

export function resetJobsForTests(): void {
  started.clear()
  inflight.clear()
  cancelled.clear()
}

export function abandonJob(localId: string): void {
  cancelled.add(localId)
  const row = inflight.get(localId)
  if (row) {
    row.abandoned = true
    killProcessGroup(row.pid)
  }
}

export function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isReusableAnalyzePrior(prior: JobHandle, current: JobHandle): boolean {
  return (
    current.kind === 'analyze' &&
    prior.kind === 'analyze' &&
    prior.id !== current.id &&
    prior.ownerAgentId === current.ownerAgentId &&
    prior.status === 'complete' &&
    Boolean(prior.pmJobId) &&
    normalizeGoal(prior.goal) === normalizeGoal(current.goal)
  )
}

export function reusableAnalyzeSpoken(snap: StatusSnap, refs: unknown): string | null {
  if (jobOutcome(snap) !== 'complete') return null
  return substantiveSpokenFromRefs(refs)
}

export function findReusableAnalyze(
  current: JobHandle,
  knownJobs: JobHandle[],
  readLiveStatus: StatusReader,
  readLiveRefs: RefsReader,
): AnalyzeReuseHit | null {
  if (current.kind !== 'analyze') return null
  for (let index = knownJobs.length - 1; index >= 0; index -= 1) {
    const prior = knownJobs[index]
    if (!isReusableAnalyzePrior(prior, current) || !prior.pmJobId) continue
    try {
      const spoken = reusableAnalyzeSpoken(readLiveStatus(prior.pmJobId), readLiveRefs(prior.pmJobId))
      if (spoken) return { pmJobId: prior.pmJobId, spoken }
    } catch {
      /* uncertain live read is a miss for this candidate */
    }
  }
  return null
}

export async function ensureDispatched(
  job: JobHandle,
  hooks: DispatchHooks,
  knownJobs: JobHandle[] = [],
  seams: DispatchSeams = {},
): Promise<void> {
  if (job.status !== 'running') return
  if (cancelled.has(job.id)) return
  if (started.has(job.id)) return
  started.add(job.id)
  const row: Inflight = { abandoned: false }
  inflight.set(job.id, row)
  const statusOf = seams.readStatus ?? ((pmJobId) => readStatus(pmJobId, PRODUCT_ROOT))
  const refsOf = seams.readArtifactRefs ?? ((pmJobId) => readArtifactRefs(pmJobId, PRODUCT_ROOT))
  try {
    if (job.pmJobId) {
      await attachExisting(job, row, hooks, statusOf, refsOf, seams)
      return
    }
    if (job.kind === 'box-shell') {
      const run = seams.boxShell ?? ((item) => runBoxShell(item, seams.box))
      const result = await awaitWithStatus(Promise.resolve(run(job)), row, job, hooks, seams)
      if (row.abandoned) return
      if (result.ok) hooks.onComplete(result.spoken)
      else hooks.onFail(result.spoken)
      return
    }
    if (job.kind === 'promote' || job.kind === 'ship') {
      const land = { cwd: resolveBoundProductCwd(job), ...seams.land }
      const run =
        job.kind === 'promote'
          ? (seams.promote ?? ((item) => runPromote(item, knownJobs, land)))
          : (seams.ship ?? ((item) => runShip(item, knownJobs, land)))
      await runHostLand(job, row, hooks, seams, run)
      return
    }
    if (job.kind === 'analyze') {
      const hit = findReusableAnalyze(job, knownJobs, statusOf, refsOf)
      if (hit) {
        if (row.abandoned) return
        hooks.onAttached(hit.pmJobId)
        if (row.abandoned) return
        hooks.onComplete(hit.spoken)
        return
      }
    }
    const files =
      job.kind === 'implement'
        ? (seams.implementFiles ?? writeImplementLaunch)(job)
        : (seams.analyzeFiles ?? writeAnalyzeLaunch)(job)
    const argv = buildAnalyzeArgv({
      ...files,
      label: ownerLabel(job),
      launchKey: job.id,
    })
    if (!seams.spawn && listOpenRouterKeys().length === 0) {
      if (hooks.onWaitingUser) hooks.onWaitingUser('Need an OpenRouter key.', 'staff')
      else hooks.onFail('Need an OpenRouter key.')
      return
    }
    const spawned = seams.spawn ? await seams.spawn(argv) : await spawnFresh(argv, row)
    if (row.abandoned) {
      killProcessGroup(row.pid)
      return
    }
    hooks.onAttached(spawned.pmJobId)
    await watchUntilTerminal(spawned.pmJobId, row, statusOf, seams, hooks, job)
    if (row.abandoned) return
    deliverTerminal(spawned.pmJobId, hooks, statusOf, refsOf)
  } catch (error) {
    if (row.abandoned) return
    const auth = pmAuthDenialSpoken(error)
    if (auth && hooks.onWaitingUser) hooks.onWaitingUser(auth, 'job')
    else hooks.onFail("Couldn't start.")
  } finally {
    inflight.delete(job.id)
    started.delete(job.id)
  }
}

function writeAnalyzeLaunch(job: JobHandle): { configPath: string; goalPath: string } {
  return writeAnalyzeConfig({
    localId: job.id,
    instruction: analysisInstruction(analyzePrompt(job)),
    workerCwd: analyzeCwd(resolveJobCwd(job)),
    ownerAgentId: job.ownerAgentId,
  })
}

export function implementSeedRoot(
  ownerAgentId: string,
  fallback = PRODUCT_ROOT,
  home = automatonHome(),
): string {
  const path = readProfile(ownerAgentId, home)?.homePath?.trim()
  if (path && existsSync(join(path, '.git'))) return path
  return fallback
}

/** Bound checkout only. Never Automaton-as-fallback. Host land waits when this is empty. */
export function resolveBoundProductCwd(
  job: JobHandle,
  home = automatonHome(),
  projects = listMachineProjects(),
): string | undefined {
  const hit = matchMachineProject(job.goal, projects)
  if (hit) return hit.path
  const profile = readProfile(job.ownerAgentId, home)
  const path = profile?.homePath?.trim()
  if (path && existsSync(join(path, '.git'))) return path
  const ownerHint = [profile?.name, profile?.homeRepo, profile?.title].filter(Boolean).join(' ')
  if (ownerHint) {
    const byOwner = matchMachineProject(ownerHint, projects)
    if (byOwner) return byOwner.path
  }
  return undefined
}

export function resolveJobCwd(
  job: JobHandle,
  fallback = PRODUCT_ROOT,
  home = automatonHome(),
  projects = listMachineProjects(),
): string {
  return resolveBoundProductCwd(job, home, projects) ?? implementSeedRoot(job.ownerAgentId, fallback, home)
}

function writeImplementLaunch(job: JobHandle): { configPath: string; goalPath: string } {
  return writeImplementConfig({
    localId: job.id,
    instruction: implementInstruction(job),
    workerCwd: seedSandboxFromProduct(job.id, resolveJobCwd(job)),
    ownerAgentId: job.ownerAgentId,
  })
}

async function spawnFresh(argv: string[], row: Inflight): Promise<SpawnedPm> {
  const child = spawnPm(argv, PRODUCT_ROOT)
  row.pid = child.pid
  return waitForJobId(child)
}

async function attachExisting(
  job: JobHandle,
  row: Inflight,
  hooks: DispatchHooks,
  statusOf: StatusReader,
  refsOf: RefsReader,
  seams: DispatchSeams,
): Promise<void> {
  const pmJobId = job.pmJobId
  if (!pmJobId) return
  hooks.onAttached(pmJobId)
  await watchUntilTerminal(pmJobId, row, statusOf, seams, hooks, job)
  if (row.abandoned) return
  deliverTerminal(pmJobId, hooks, statusOf, refsOf)
}

function emitKeepAlive(job: JobHandle, hooks: DispatchHooks): void {
  const note = keepAliveStatus(job)
  if (!note || note === 'Done.') return
  hooks.onStatus?.(note)
}

async function runHostLand(
  job: JobHandle,
  row: Inflight,
  hooks: DispatchHooks,
  seams: DispatchSeams,
  run: (item: JobHandle) => HostResult | Promise<HostResult>,
): Promise<void> {
  const pause = seams.sleep ?? sleep
  const waitMs = seams.externalWaitMs ?? EXTERNAL_WAIT_MS
  let notedWait = false
  let current = job
  for (;;) {
    const result = await awaitWithStatus(Promise.resolve(run(current)), row, current, hooks, seams)
    if (row.abandoned) return
    if (result.waitingUser) {
      const source = result.source ?? 'staff'
      if (hooks.onWaitingUser) hooks.onWaitingUser(result.spoken, source)
      else hooks.onFail(result.spoken)
      return
    }
    if (result.waitingExternal) {
      hooks.onWaitingExternal?.(result.spoken)
      if (!notedWait) {
        hooks.onStatus?.(WAITING_CHECKS)
        notedWait = true
      }
      current = { ...current, lastNote: WAITING_CHECKS }
      await pause(waitMs)
      if (row.abandoned) return
      continue
    }
    if (result.ok) hooks.onComplete(result.spoken)
    else hooks.onFail(result.spoken)
    return
  }
}

async function awaitWithStatus<T>(
  work: Promise<T>,
  row: Inflight,
  job: JobHandle,
  hooks: DispatchHooks,
  seams: DispatchSeams,
): Promise<T> {
  if (!hooks.onStatus) return work
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tracked = work.finally(() => {
    settled = true
    if (timer) clearTimeout(timer)
  })
  if (seams.sleep) {
    void seams.sleep(STATUS_FIRST_DELAY_MS).then(() => {
      if (settled || row.abandoned) return
      emitKeepAlive(job, hooks)
    })
  } else {
    timer = setTimeout(() => {
      if (settled || row.abandoned) return
      emitKeepAlive(job, hooks)
    }, STATUS_FIRST_DELAY_MS)
  }
  return tracked
}

async function watchUntilTerminal(
  pmJobId: string,
  row: Inflight,
  statusOf: StatusReader,
  seams: DispatchSeams,
  hooks: DispatchHooks,
  job: JobHandle,
): Promise<void> {
  const pause = seams.sleep ?? sleep
  const grace = seams.maxUnavailableStatusReads ?? WATCH_UNAVAILABLE_GRACE
  let unavailable = 0
  let waited = 0
  let lastStatusAt = -1
  for (;;) {
    if (row.abandoned) return
    try {
      if (jobOutcome(statusOf(pmJobId)) !== 'running') return
      unavailable = 0
      if (
        hooks.onStatus &&
        waited >= STATUS_FIRST_DELAY_MS &&
        (lastStatusAt < 0 || waited - lastStatusAt >= STATUS_THROTTLE_MS)
      ) {
        emitKeepAlive(job, hooks)
        lastStatusAt = waited
      }
    } catch {
      unavailable += 1
      if (unavailable >= grace) return
    }
    await pause(WATCH_POLL_MS)
    waited += WATCH_POLL_MS
  }
}

function spokenAuthLine(parts: string[]): string | null {
  const text = parts.join('\n')
  if (!isDefinitiveAuthDenial(text)) return null
  const line = parts
    .flatMap((part) => part.split('\n'))
    .map((row) => row.trim())
    .find((row) => row.length > 0 && row.length < 180 && isDefinitiveAuthDenial(row))
  return boundGoalEvidence(line || 'Authentication or authorization was denied.')
}

/** Puppetmaster: thrown Error or status error fields only. Never refs, FINDINGs, or JSON blobs. */
function pmAuthDenialSpoken(error?: unknown, snap?: StatusSnap): string | null {
  const parts: string[] = []
  if (error instanceof Error) parts.push(error.message)
  if (typeof snap?.job?.error === 'string') parts.push(snap.job.error)
  if (typeof snap?.error === 'string') parts.push(snap.error)
  return spokenAuthLine(parts)
}

function deliverTerminal(
  pmJobId: string,
  hooks: DispatchHooks,
  statusOf: StatusReader,
  refsOf: RefsReader,
): void {
  let snap: StatusSnap
  try {
    snap = statusOf(pmJobId)
  } catch (error) {
    const auth = pmAuthDenialSpoken(error)
    if (auth && hooks.onWaitingUser) hooks.onWaitingUser(auth, 'job')
    else hooks.onFail("Didn't land.")
    return
  }
  let refs: unknown = null
  try {
    refs = refsOf(pmJobId)
  } catch {
    refs = null
  }
  if (jobOutcome(snap) !== 'complete') {
    const auth = pmAuthDenialSpoken(undefined, snap)
    if (auth && hooks.onWaitingUser) hooks.onWaitingUser(auth, 'job')
    else hooks.onFail("Didn't land.")
    return
  }
  let spoken: string | null
  try {
    spoken = substantiveSpokenFromRefs(refs)
  } catch {
    spoken = null
  }
  if (!spoken) {
    hooks.onFail("Didn't land.")
    return
  }
  hooks.onComplete(spoken)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
