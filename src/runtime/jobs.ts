import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { JobHandle } from '../domain'
import { automatonHome, listOpenRouterKeys } from './keys'
import { type BoxSeams } from './box'
import { runBoxShell } from './box-shell'
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
  onComplete: (spoken: string) => void
  onFail: (spoken: string) => void
}

export type AnalyzeReuseHit = {
  pmJobId: string
  spoken: string
}

export const WATCH_UNAVAILABLE_GRACE = 3

export type DispatchSeams = {
  readStatus?: (pmJobId: string) => StatusSnap
  readArtifactRefs?: (pmJobId: string) => unknown
  spawn?: (argv: string[]) => Promise<SpawnedPm>
  analyzeFiles?: (job: JobHandle) => { configPath: string; goalPath: string }
  implementFiles?: (job: JobHandle) => { configPath: string; goalPath: string }
  sleep?: (ms: number) => Promise<void>
  maxUnavailableStatusReads?: number
  box?: BoxSeams
  boxShell?: (job: JobHandle) => { ok: boolean; spoken: string }
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
      await attachExisting(job.pmJobId, row, hooks, statusOf, refsOf, seams)
      return
    }
    if (job.kind === 'box-shell') {
      const result = (seams.boxShell ?? ((item) => runBoxShell(item, seams.box)))(job)
      if (row.abandoned) return
      if (result.ok) hooks.onComplete(result.spoken)
      else hooks.onFail(result.spoken)
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
      hooks.onFail('Need an OpenRouter key.')
      return
    }
    const spawned = seams.spawn ? await seams.spawn(argv) : await spawnFresh(argv, row)
    if (row.abandoned) {
      killProcessGroup(row.pid)
      return
    }
    hooks.onAttached(spawned.pmJobId)
    await watchUntilTerminal(spawned.pmJobId, row, statusOf, seams)
    if (row.abandoned) return
    deliverTerminal(spawned.pmJobId, hooks, statusOf, refsOf)
  } catch {
    if (row.abandoned) return
    hooks.onFail("Couldn't start.")
  } finally {
    inflight.delete(job.id)
    started.delete(job.id)
  }
}

function writeAnalyzeLaunch(job: JobHandle): { configPath: string; goalPath: string } {
  return writeAnalyzeConfig({
    localId: job.id,
    instruction: analysisInstruction(analyzePrompt(job)),
    workerCwd: analyzeCwd(implementSeedRoot(job.ownerAgentId)),
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

function writeImplementLaunch(job: JobHandle): { configPath: string; goalPath: string } {
  return writeImplementConfig({
    localId: job.id,
    instruction: implementInstruction(job),
    workerCwd: seedSandboxFromProduct(job.id, implementSeedRoot(job.ownerAgentId)),
  })
}

async function spawnFresh(argv: string[], row: Inflight): Promise<SpawnedPm> {
  const child = spawnPm(argv, PRODUCT_ROOT)
  row.pid = child.pid
  return waitForJobId(child)
}

async function attachExisting(
  pmJobId: string,
  row: Inflight,
  hooks: DispatchHooks,
  statusOf: StatusReader,
  refsOf: RefsReader,
  seams: DispatchSeams,
): Promise<void> {
  hooks.onAttached(pmJobId)
  await watchUntilTerminal(pmJobId, row, statusOf, seams)
  if (row.abandoned) return
  deliverTerminal(pmJobId, hooks, statusOf, refsOf)
}

async function watchUntilTerminal(
  pmJobId: string,
  row: Inflight,
  statusOf: StatusReader,
  seams: DispatchSeams,
): Promise<void> {
  const pause = seams.sleep ?? sleep
  const grace = seams.maxUnavailableStatusReads ?? WATCH_UNAVAILABLE_GRACE
  let unavailable = 0
  for (;;) {
    if (row.abandoned) return
    try {
      if (jobOutcome(statusOf(pmJobId)) !== 'running') return
      unavailable = 0
    } catch {
      unavailable += 1
      if (unavailable >= grace) return
    }
    await pause(1500)
  }
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
  } catch {
    hooks.onFail("Didn't land.")
    return
  }
  if (jobOutcome(snap) !== 'complete') {
    hooks.onFail("Didn't land.")
    return
  }
  let spoken: string | null
  try {
    spoken = substantiveSpokenFromRefs(refsOf(pmJobId))
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
