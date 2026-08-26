import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import { adoptMarionetteOpenRouterKey, resolveOpenRouterKey } from '../src/runtime/keys'
import {
  chatOpenRouter,
  ensureMouth,
  resetMouthForTests,
  type ChatFn,
} from '../src/runtime/mouth'
import { openStaffStore, type LedgerMetrics, type TurnReceipt } from '../src/runtime/store'
import { claimTaskKey } from '../src/runtime/working-set'
import { completeMouth, pendingMouthTurns, send } from '../src/session'

const PRODUCT_ROOT = join(import.meta.dir, '..')

export type MouthProbeMetrics = {
  outcome: 'hit' | 'miss'
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  inferenceAvoided: boolean
  inferenceAttempted: boolean
  status: string
  spoken: string
  calls: number
}

export type MouthProbeReport = {
  source: string
  adopted: boolean
  failed: boolean
  canned: boolean
  spoken: string
  recall: MouthProbeMetrics
  inference: MouthProbeMetrics
  ledger: LedgerMetrics
}

export function redactSecrets(text: string): string {
  return text.replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]')
}

export function isMouthProbeReport(value: unknown): value is MouthProbeReport {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (typeof row.source !== 'string') return false
  if (typeof row.adopted !== 'boolean') return false
  if (typeof row.failed !== 'boolean') return false
  if (typeof row.canned !== 'boolean') return false
  if (typeof row.spoken !== 'string') return false
  return isMetrics(row.recall) && isMetrics(row.inference) && isLedger(row.ledger)
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number'
}

function isMetrics(value: unknown): value is MouthProbeMetrics {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    (row.outcome === 'hit' || row.outcome === 'miss') &&
    (row.model === null || typeof row.model === 'string') &&
    isNullableNumber(row.promptTokens) &&
    isNullableNumber(row.completionTokens) &&
    isNullableNumber(row.costUsd) &&
    typeof row.inferenceAvoided === 'boolean' &&
    typeof row.inferenceAttempted === 'boolean' &&
    typeof row.status === 'string' &&
    typeof row.spoken === 'string' &&
    typeof row.calls === 'number'
  )
}

function isLedger(value: unknown): value is LedgerMetrics {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.turns === 'number' &&
    typeof row.hits === 'number' &&
    typeof row.misses === 'number' &&
    typeof row.inferenceAvoided === 'number' &&
    typeof row.inferenceCalls === 'number' &&
    isNullableNumber(row.promptTokens) &&
    isNullableNumber(row.completionTokens) &&
    isNullableNumber(row.costUsd) &&
    typeof row.promptTokensKnown === 'number' &&
    typeof row.promptTokensUnknown === 'number' &&
    typeof row.completionTokensKnown === 'number' &&
    typeof row.completionTokensUnknown === 'number' &&
    typeof row.costKnown === 'number' &&
    typeof row.costUnknown === 'number'
  )
}

function metricsFrom(
  receipt: TurnReceipt | null,
  spoken: string,
  calls: number,
): MouthProbeMetrics {
  return {
    outcome: receipt?.outcome ?? 'miss',
    model: receipt?.model ?? null,
    promptTokens: receipt?.promptTokens ?? null,
    completionTokens: receipt?.completionTokens ?? null,
    costUsd: receipt?.costUsd ?? null,
    inferenceAvoided: receipt?.inferenceAvoided ?? false,
    inferenceAttempted: receipt?.inferenceAttempted ?? false,
    status: receipt?.status ?? 'failed',
    spoken: redactSecrets(spoken),
    calls,
  }
}

export async function runMouthProbe(input?: {
  storePath?: string
  chat?: ChatFn
  keys?: { key: string; source: 'env' | 'automaton' | 'marionette' | 'missing' }[]
}): Promise<MouthProbeReport> {
  resetIdsForTests()
  resetMouthForTests()
  const adopted = adoptMarionetteOpenRouterKey()
  const resolved = resolveOpenRouterKey()
  const store = openStaffStore(
    input?.storePath ?? join(tmpdir(), `automaton-probe-mouth-${Date.now()}.sqlite`),
  )
  let session = {
    agents: DEFAULT_AGENTS,
    activeAgentId: 'staff' as const,
    threads: emptyThreads(DEFAULT_AGENTS),
    jobs: [],
    pendingFanout: null,
  }

  store.remember({
    ownerAgentId: 'kernel',
    text: 'The ledger replay is deterministic.',
    source: 'job',
    jobId: 'job_probe_seed',
    taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'ledger replay' }),
    artifactKind: 'analyze',
    freshness: 'fresh',
  })

  session = send(session, 'what did Kernel find about ledger replay')
  const recallTurn = pendingMouthTurns(session)[0]
  let recallSpoken = ''
  let recallFailed = false
  let recallCalls = 0
  await ensureMouth(
    session,
    store,
    {
      onComplete: (_agentId, text) => {
        recallSpoken = text
      },
      onFail: (_agentId, text) => {
        recallSpoken = text
        recallFailed = true
      },
    },
    async (...args) => {
      recallCalls += 1
      if (input?.chat) return input.chat(...args)
      return 'should not run'
    },
    input?.keys ?? [{ key: 'unused', source: 'automaton' }],
  )
  const recallReceipt = recallTurn ? store.receipt(recallTurn.itemId) : null

  session = completeMouth(session, 'staff', recallSpoken || 'Done.')
  session = send(session, 'Hello, what is your name?')
  const inferTurn = pendingMouthTurns(session)[0]
  let spoken = ''
  let failed = false
  let inferCalls = 0
  await ensureMouth(
    session,
    store,
    {
      onComplete: (_agentId, text) => {
        spoken = text
      },
      onFail: (_agentId, text) => {
        spoken = text
        failed = true
      },
    },
    async (...args) => {
      inferCalls += 1
      if (input?.chat) return input.chat(...args)
      return chatOpenRouter(...args)
    },
    input?.keys,
  )
  const inferReceipt = inferTurn ? store.receipt(inferTurn.itemId) : null
  const canned = /I can dispatch Kernel or Research/i.test(spoken)

  return {
    source: resolved.source,
    adopted: adopted.copied,
    failed: failed || recallFailed,
    canned,
    spoken: redactSecrets(spoken),
    recall: metricsFrom(recallReceipt, recallSpoken, recallCalls),
    inference: metricsFrom(inferReceipt, spoken, inferCalls),
    ledger: store.metrics(),
  }
}

export function writeMouthProbeArtifact(report: MouthProbeReport, dest = join(PRODUCT_ROOT, 'artifacts', 'mouth-probe.json')): void {
  mkdirSync(join(PRODUCT_ROOT, 'artifacts'), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`)
}

if (import.meta.main) {
  const report = await runMouthProbe()
  writeMouthProbeArtifact(report)
  if (
    report.recall.calls !== 0 ||
    !report.recall.inferenceAvoided ||
    report.recall.inferenceAttempted ||
    report.ledger.inferenceAvoided !== 1
  ) {
    console.log('mouth probe failed recall was not zero-call')
    process.exit(1)
  }
  const resolved = resolveOpenRouterKey()
  if (!resolved.key) {
    console.log(`mouth probe skipped source=${report.source}`)
    process.exit(0)
  }
  if (report.failed || report.canned || !report.spoken.trim()) {
    console.log(`mouth probe failed canned=${report.canned}`)
    process.exit(1)
  }
  if (!report.inference.inferenceAttempted || report.ledger.inferenceCalls !== 1) {
    console.log('mouth probe failed inference was not attempted')
    process.exit(1)
  }
  console.log(`mouth probe ok source=${report.source} chars=${report.spoken.length}`)
}
