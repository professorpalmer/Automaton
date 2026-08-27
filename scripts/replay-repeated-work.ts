import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import { ensureMouth, resetMouthForTests, type ChatFn } from '../src/runtime/mouth'
import { openStaffStore, type LedgerMetrics } from '../src/runtime/store'
import { claimTaskKey } from '../src/runtime/working-set'
import { completeMouth, pendingMouthTurns, send, type Session } from '../src/session'

const PRODUCT_ROOT = join(import.meta.dir, '..')
const MISS_QUERY = 'Hello, what is your name?'
const RECALL_QUERY = 'what did Kernel find about ledger replay'
const FINDING = 'The ledger replay is deterministic.'
const JOB_ID = 'job_1'
const TURN_COUNT = 20
const MOCK_KEYS = [{ key: 'sk-or-test', source: 'automaton' as const }]

export const SESSION_RATE_NOTE =
  'This 95% is a session-level hit rate across a day of work, not a discount on a single new task. The first look at a repo, paper, or bug still pays a full mouth call. Later turns that come back to that same finding query the store and skip the model. A typical day is mostly those later turns; that mix is why 19 of 20 turns avoided inference. One novel task is still one paid call (100% of that turn).'

export const WORKLOAD_DESCRIPTION =
  '20 user turns against Automaton ensureMouth + StaffStore + queryFirst. Turn 1 is a novel question that is not a recall, so queryFirst misses and one mocked ChatFn call is the paid inference. Chat misses do not auto-remember(); after that miss the replay seeds one job-sourced Kernel claim as if a worker had finished. Turns 2-20 send the recall query from tests/mouth.test.ts and must hit with inferenceAvoided=true and no further ChatFn calls. Uses a temp sqlite path, never ~/.automaton/staff.sqlite. This is not Cary Palmer live mixed ledger (1 hit / 51 turns).'

export type ReplayTurnRow = {
  n: number
  query: string
  outcome: 'hit' | 'miss'
  inferenceAvoided: boolean
  inferenceAttempted: boolean
  chatCalls: number
}

export type RepeatedWorkLedger = {
  workload: {
    description: string
    turns: number
    missQuery: string
    recallQuery: string
    seededClaim: {
      ownerAgentId: string
      text: string
      source: 'job'
      jobId: string
      taskKey: string
      artifactKind: 'analyze'
      freshness: 'fresh'
    }
    liveMixedLedger: { hits: number; turns: number; note: string }
    sessionRateNote: string
  }
  turns: ReplayTurnRow[]
  summary: {
    turns: number
    misses: number
    hits: number
    inferenceAvoided: number
    inferenceCalls: number
    chatCalls: number
    avoidedOverTotal: number
  }
  store: { path: string; liveHomeStore: false }
  gitSha: string
  capturedAt: string
  ledger: LedgerMetrics
}

export const DEFAULT_LEDGER_PATH = join(PRODUCT_ROOT, 'artifacts', 'repeated-work-ledger.json')

function gitSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: PRODUCT_ROOT,
    encoding: 'utf8',
  }).trim()
}

function emptySession(): Session {
  const agents = staffWithSisters()
  return {
    agents,
    activeAgentId: 'staff',
    threads: emptyThreads(agents),
    jobs: [],
    pendingFanout: null,
  }
}

async function playTurn(input: {
  session: Session
  store: ReturnType<typeof openStaffStore>
  query: string
  chat: ChatFn
  chatCallsBefore: { n: number }
}): Promise<{ session: Session; row: ReplayTurnRow; n: number }> {
  const before = input.chatCallsBefore.n
  let session = send(input.session, input.query)
  const turn = pendingMouthTurns(session)[0]
  if (!turn) {
    throw new Error(`no pending mouth turn for ${JSON.stringify(input.query)}`)
  }
  if (turn.agentId !== 'staff' || turn.mode !== 'chat') {
    throw new Error(`expected staff chat turn, got ${turn.agentId}/${turn.mode}`)
  }
  let spoken = ''
  await ensureMouth(
    session,
    input.store,
    {
      onComplete: (_agentId, text) => {
        spoken = text
      },
      onFail: (_agentId, text) => {
        spoken = text
      },
    },
    input.chat,
    MOCK_KEYS,
  )
  const receipt = input.store.receipt(turn.itemId)
  if (!receipt) throw new Error(`missing receipt for ${turn.itemId}`)
  session = completeMouth(session, turn.agentId, spoken || 'Done.')
  return {
    session,
    n: input.chatCallsBefore.n - before,
    row: {
      n: 0,
      query: input.query,
      outcome: receipt.outcome,
      inferenceAvoided: receipt.inferenceAvoided,
      inferenceAttempted: receipt.inferenceAttempted,
      chatCalls: input.chatCallsBefore.n - before,
    },
  }
}

export async function runRepeatedWorkReplay(input?: {
  storePath?: string
  dest?: string | null
}): Promise<RepeatedWorkLedger> {
  resetIdsForTests()
  resetMouthForTests()
  const storePath = input?.storePath ?? join(tmpdir(), `automaton-repeated-work-${Date.now()}.sqlite`)
  const store = openStaffStore(storePath)
  const chatCalls = { n: 0 }
  const chat: ChatFn = async () => {
    chatCalls.n += 1
    return {
      text: 'Staff. I coordinate Kernel and Research.',
      usage: { promptTokens: 11, completionTokens: 4, costUsd: 0.0002 },
    }
  }

  let session = emptySession()
  const turns: ReplayTurnRow[] = []

  const miss = await playTurn({
    session,
    store,
    query: MISS_QUERY,
    chat,
    chatCallsBefore: chatCalls,
  })
  session = miss.session
  turns.push({ ...miss.row, n: 1 })
  if (miss.row.outcome !== 'miss' || miss.row.inferenceAvoided || !miss.row.inferenceAttempted || miss.row.chatCalls !== 1) {
    throw new Error(`turn 1 was not a paid miss: ${JSON.stringify(miss.row)}`)
  }
  if (store.listClaims().length !== 0) {
    throw new Error('chat miss auto-remembered; Automaton must not persist a mouth miss as a claim')
  }

  const taskKey = claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'ledger replay' })
  store.remember({
    ownerAgentId: 'kernel',
    text: FINDING,
    source: 'job',
    jobId: JOB_ID,
    taskKey,
    artifactKind: 'analyze',
    freshness: 'fresh',
  })

  for (let n = 2; n <= TURN_COUNT; n += 1) {
    const hit = await playTurn({
      session,
      store,
      query: RECALL_QUERY,
      chat,
      chatCallsBefore: chatCalls,
    })
    session = hit.session
    turns.push({ ...hit.row, n })
    if (hit.row.outcome !== 'hit' || !hit.row.inferenceAvoided || hit.row.inferenceAttempted || hit.row.chatCalls !== 0) {
      throw new Error(`turn ${n} was not a zero-call recall: ${JSON.stringify(hit.row)}`)
    }
  }

  if (chatCalls.n !== 1) {
    throw new Error(`ChatFn calls stayed ${chatCalls.n}, expected 1`)
  }

  const ledger = store.metrics()
  const summary = {
    turns: ledger.turns,
    misses: ledger.misses,
    hits: ledger.hits,
    inferenceAvoided: ledger.inferenceAvoided,
    inferenceCalls: ledger.inferenceCalls,
    chatCalls: chatCalls.n,
    avoidedOverTotal: ledger.turns === 0 ? 0 : ledger.inferenceAvoided / ledger.turns,
  }
  if (
    summary.turns !== TURN_COUNT ||
    summary.misses !== 1 ||
    summary.hits !== 19 ||
    summary.inferenceAvoided !== 19 ||
    summary.inferenceCalls !== 1 ||
    summary.chatCalls !== 1 ||
    summary.avoidedOverTotal !== 0.95
  ) {
    throw new Error(`replay summary was not 19/20 avoided: ${JSON.stringify(summary)}`)
  }

  const report: RepeatedWorkLedger = {
    workload: {
      description: WORKLOAD_DESCRIPTION,
      turns: TURN_COUNT,
      missQuery: MISS_QUERY,
      recallQuery: RECALL_QUERY,
      seededClaim: {
        ownerAgentId: 'kernel',
        text: FINDING,
        source: 'job',
        jobId: JOB_ID,
        taskKey,
        artifactKind: 'analyze',
        freshness: 'fresh',
      },
      liveMixedLedger: {
        hits: 1,
        turns: 51,
        note: 'Cary Palmer live ~/.automaton/staff.sqlite mix is 1 hit / 51 turns. That mix is not this workload.',
      },
      sessionRateNote: SESSION_RATE_NOTE,
    },
    turns,
    summary,
    store: { path: storePath, liveHomeStore: false },
    gitSha: gitSha(),
    capturedAt: new Date().toISOString(),
    ledger,
  }

  if (input?.dest !== null) {
    writeRepeatedWorkLedger(report, input?.dest ?? DEFAULT_LEDGER_PATH)
  }
  return report
}

export function writeRepeatedWorkLedger(report: RepeatedWorkLedger, dest = DEFAULT_LEDGER_PATH): void {
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`)
}

if (import.meta.main) {
  const report = await runRepeatedWorkReplay()
  const { summary } = report
  console.log(
    `repeated-work replay turns=${summary.turns} misses=${summary.misses} hits=${summary.hits} avoided=${summary.inferenceAvoided} calls=${summary.inferenceCalls} avoided/total=${summary.avoidedOverTotal} sha=${report.gitSha}`,
  )
}
