import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emptyThreads, jobKindForKit, resetIdsForTests, staffWithSisters } from '../src/domain'
import { ensureMouth, resetMouthForTests, type ChatFn } from '../src/runtime/mouth'
import { openStaffStore, type LedgerMetrics, type RememberInput } from '../src/runtime/store'
import { claimTaskKey } from '../src/runtime/working-set'
import { completeMouth, pendingMouthTurns, send, type Session } from '../src/session'

const PRODUCT_ROOT = join(import.meta.dir, '..')
export const WORKDAY_EVAL_SEED = 20260827
export const TURN_COUNT = 400
export const WINDOW = 50
export const PRIMARY_NOVEL_RATE = 0.05
export const NOVEL_RATES = [0.05, 0.10, 0.20] as const
export const TAIL_FOLLOWUP = 2
export const TAIL_UNRELATED = 2
export const MISS_COST_USD = 0.001
const MOCK_KEYS = [{ key: 'sk-or-test', source: 'automaton' as const }]

export const WORKLOAD_DESCRIPTION =
  'Seeded workday saturation workload against Automaton ensureMouth + StaffStore + queryFirst. Empty store. 400 turns that look like a workday: morning-weighted first-looks (novel miss, then persist a job-sourced Kernel claim the way a finished worker would), later recall-shaped paraphrases of findings already persisted that day, interleaved so the cumulative curve climbs. Small follow-up/unrelated tail, labeled in gold. Primary mix is ~5% first-looks (1 in 20 novel). Same generator also runs 10% and 20% novel. Measures current gates (RECALL_REQUEST, uniqueSpeakable, skip stale, taskKey, owner) without retuning queryFirst. Chat misses do not remember() themselves. Temp sqlite only; never ~/.automaton/staff.sqlite.'

export const INTERPRETATION =
  '95% is the cost of a workday when about 1 in 20 turns is novel and the rest are recall-shaped revisits of work already in the store. When the novel fraction is F, avoidance tracks ~1-F if the gates are clean. The 19/20 replay is the single-finding limit (1 miss + 19 hits). The hostile 330 (25.15% avoidance, 0 false hits, 0 stale hits) is the safety score: the cache refuses the wrong commit. Live ~/.automaton/staff.sqlite (1 hit / 51 turns) is an early mixed desk, not a full workday on one domain.'

export type GoldReason = 'first-look' | 'revisit-paraphrase' | 'followup' | 'unrelated'

export type GoldTurn = {
  expect: 'hit' | 'miss'
  reason: GoldReason
  claimId?: string
}

type Finding = {
  key: string
  topic: string
  text: string
  repo: string
  revision: string
  jobId: string
}

function asRemember(finding: Finding): RememberInput {
  return {
    ownerAgentId: 'kernel',
    text: finding.text,
    source: 'job',
    jobId: finding.jobId,
    taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: finding.topic }),
    repo: finding.repo,
    revision: finding.revision,
    artifactKind: 'analyze',
    freshness: 'fresh',
  }
}

/** Two-token Kernel topics. Each word is >= 3 chars and outside queryFirst stop/owner lists. */
const FINDING_ROWS: Array<[string, string, string]> = [
  ['ledger', 'replay', 'deterministic'],
  ['parser', 'timeout', 'thirty milliseconds'],
  ['cite', 'catalog', 'complete'],
  ['auth', 'cookie', 'httponly'],
  ['rfc', 'draft', 'one example short'],
  ['queue', 'drain', 'single threaded'],
  ['blob', 'clock', 'monotonic'],
  ['rank', 'order', 'recency first'],
  ['lease', 'expiry', 'five minutes'],
  ['column', 'maps', 'omitted'],
  ['bloom', 'filter', 'enabled'],
  ['style', 'guide', 'comma free'],
  ['cache', 'header', 'private'],
  ['token', 'bucket', 'refill linear'],
  ['wal', 'segment', 'fixed size'],
  ['span', 'sampler', 'head based'],
  ['cron', 'window', 'nightly'],
  ['index', 'freeze', 'offline'],
  ['feed', 'cursor', 'inclusive'],
  ['quota', 'window', 'fifteen minutes'],
  ['socket', 'backlog', 'five twelve'],
  ['widget', 'paint', 'cpu bound'],
  ['mutex', 'order', 'address based'],
  ['hint', 'btree', 'default'],
  ['retry', 'budget', 'three attempts'],
  ['page', 'cursor', 'stable'],
  ['backoff', 'curve', 'exponential'],
  ['checksum', 'trail', 'crc32'],
  ['timezone', 'table', 'iana'],
  ['proto', 'schema', 'frozen'],
  ['wasm', 'guest', 'sandboxed'],
  ['metric', 'export', 'otlp'],
  ['shard', 'hasher', 'consistent'],
  ['failover', 'quorum', 'majority'],
  ['compact', 'pass', 'level based'],
  ['hydrate', 'batch', 'idempotent'],
  ['nonce', 'cache', 'single use'],
  ['secret', 'envelope', 'wrapped'],
  ['session', 'cookie', 'secure'],
  ['origin', 'allow', 'exact host'],
  ['cors', 'preflight', 'cached'],
  ['rate', 'limit', 'per seat'],
  ['audit', 'trail', 'append only'],
  ['event', 'bus', 'in process'],
  ['task', 'queue', 'fifo'],
  ['worker', 'pool', 'sized eight'],
  ['lease', 'fence', 'monotonic'],
  ['lock', 'table', 'row level'],
  ['bloom', 'rehash', 'double'],
  ['vector', 'clock', 'per replica'],
  ['snapshot', 'isolation', 'repeatable'],
  ['write', 'ahead', 'group commit'],
  ['read', 'lease', 'bounded'],
  ['schema', 'epoch', 'monotonic'],
  ['column', 'store', 'run length'],
  ['row', 'cache', 'clock eviction'],
  ['query', 'planner', 'cost based'],
  ['join', 'order', 'greedy'],
  ['agg', 'spill', 'disk backed'],
  ['sort', 'run', 'replacement'],
  ['hash', 'join', 'grace'],
  ['nested', 'loop', 'index backed'],
  ['bitmap', 'index', 'compressed'],
  ['prefix', 'tree', 'byte wise'],
  ['suffix', 'array', 'induced'],
  ['token', 'stream', 'lazy'],
  ['lexer', 'mode', 'sticky'],
  ['parse', 'forest', 'packed'],
  ['type', 'infer', 'hindley'],
  ['macro', 'hygiene', 'scope local'],
  ['midend', 'lowering', 'ssa'],
  ['reg', 'alloc', 'linear scan'],
  ['inlining', 'budget', 'size based'],
  ['escape', 'analysis', 'stack prefer'],
  ['collector', 'nursery', 'copying'],
  ['heap', 'card', 'remembered'],
  ['frame', 'table', 'precise'],
  ['safepoint', 'poll', 'implicit'],
  ['deopt', 'frame', 'reconstructed'],
  ['inline', 'cache', 'polymorphic'],
  ['trace', 'jit', 'hot loop'],
  ['osr', 'entry', 'stack splice'],
  ['abi', 'lowering', 'sysv'],
  ['syscall', 'table', 'filtered'],
  ['seccomp', 'profile', 'strict'],
  ['cgroup', 'limit', 'memory'],
  ['namespace', 'mount', 'private'],
  ['overlay', 'diff', 'copy up'],
  ['image', 'layer', 'content hashed'],
  ['registry', 'index', 'list hashed'],
  ['sbom', 'cycle', 'cyclonedx'],
  ['attest', 'bundle', 'in toto'],
  ['cosign', 'key', 'fulcio issued'],
  ['policy', 'gate', 'admission'],
  ['network', 'policy', 'default deny'],
  ['service', 'mesh', 'sidecars'],
  ['ingress', 'route', 'host based'],
  ['egress', 'proxy', 'explicit'],
  ['dns', 'cache', 'negative'],
  ['tls', 'ticket', 'rotated'],
  ['ocsp', 'staple', 'must staple'],
  ['cert', 'pin', 'backup'],
  ['hsts', 'preload', 'enabled'],
  ['csp', 'policy', 'strict dynamic'],
  ['sri', 'hash', 'sha384'],
  ['cookie', 'samesite', 'lax'],
  ['csrf', 'token', 'double submit'],
  ['oauth', 'scope', 'least privilege'],
  ['oidc', 'nonce', 'single use'],
  ['saml', 'clock', 'skew tolerant'],
  ['webauthn', 'origin', 'bound'],
  ['passkey', 'resident', 'preferred'],
  ['recovery', 'code', 'hashed'],
  ['mailbox', 'verify', 'one shot'],
  ['invite', 'token', 'expiring'],
  ['seat', 'quota', 'hard cap'],
  ['billing', 'period', 'calendar'],
  ['invoice', 'line', 'itemized'],
  ['usage', 'meter', 'per turn'],
  ['credit', 'grant', 'monthly'],
  ['refund', 'window', 'seven days'],
  ['payout', 'batch', 'next day'],
  ['forex', 'rate', 'mid market'],
  ['tax', 'table', 'region based'],
  ['sku', 'catalog', 'versioned'],
  ['cart', 'hold', 'fifteen minutes'],
  ['stock', 'count', 'eventual'],
  ['warehouse', 'bin', 'pick path'],
  ['label', 'print', 'zpl'],
  ['route', 'plan', 'nearest'],
  ['driver', 'shift', 'four hours'],
  ['eta', 'model', 'traffic aware'],
  ['geofence', 'alert', 'enter'],
  ['device', 'twin', 'desired'],
  ['sensor', 'delta', 'deadband'],
  ['firmware', 'slot', 'a b'],
  ['canary', 'slice', 'five percent'],
  ['feature', 'flag', 'user hashed'],
  ['experiment', 'arm', 'sticky'],
  ['funnel', 'step', 'exclusive'],
  ['cohort', 'window', 'seven days'],
  ['retention', 'curve', 'weekly'],
  ['alert', 'budget', 'error'],
  ['slo', 'window', 'thirty days'],
  ['pager', 'policy', 'round robin'],
  ['runbook', 'link', 'canonical'],
  ['postmortem', 'action', 'owned'],
  ['oncall', 'handoff', 'written'],
  ['status', 'page', 'public'],
  ['incident', 'channel', 'dedicated'],
  ['severity', 'matrix', 'customer facing'],
  ['rollback', 'plan', 'one command'],
  ['freeze', 'window', 'holiday'],
  ['change', 'ticket', 'linked'],
  ['deploy', 'token', 'short lived'],
  ['artifact', 'digest', 'sha256'],
  ['provenance', 'predicate', 'slsa'],
  ['repro', 'recipe', 'hermetic'],
  ['cache', 'key', 'input hashed'],
  ['remote', 'exec', 'rbe'],
  ['test', 'shard', 'timing'],
  ['flake', 'quarantine', 'owner tagged'],
  ['coverage', 'gate', 'diff based'],
  ['lint', 'config', 'shared'],
  ['format', 'hook', 'pre commit'],
  ['license', 'scan', 'allowlist'],
  ['secret', 'scan', 'pre push'],
  ['dep', 'bot', 'grouped'],
  ['advisory', 'feed', 'osv'],
  ['cvss', 'floor', 'high'],
  ['tuesday', 'batch', 'grouped'],
  ['backup', 'window', 'hourly'],
  ['restore', 'drill', 'monthly'],
  ['rpo', 'target', 'five minutes'],
  ['rto', 'target', 'thirty minutes'],
  ['replica', 'lag', 'bounded'],
  ['binlog', 'retain', 'seven days'],
  ['vacuum', 'pass', 'autovacuum'],
  ['analyze', 'stats', 'nightly'],
  ['toast', 'threshold', 'two kb'],
  ['fillfactor', 'leaf', 'ninety'],
  ['hot', 'update', 'in place'],
  ['brin', 'range', 'block min'],
  ['gin', 'pending', 'fast update'],
  ['gist', 'penalty', 'smallest'],
  ['spgist', 'split', 'prefix'],
  ['bloom', 'length', 'eighty bits'],
  ['rum', 'posting', 'add'],
  ['tsvector', 'config', 'english'],
  ['trigram', 'index', 'gin'],
  ['citext', 'column', 'case fold'],
  ['hstore', 'bag', 'text keys'],
  ['jsonb', 'path', 'indexed'],
  ['range', 'type', 'inclusive'],
  ['enum', 'label', 'append only'],
  ['domain', 'check', 'not null'],
  ['trigger', 'func', 'row level'],
  ['notify', 'channel', 'payload'],
  ['listen', 'loop', 'dedicated'],
  ['fdw', 'pushdown', 'filter'],
  ['logical', 'slot', 'retained'],
  ['publication', 'set', 'all tables'],
  ['subscription', 'origin', 'ignore'],
  ['sequence', 'cache', 'per session'],
  ['identity', 'always', 'override'],
  ['generated', 'column', 'stored'],
  ['partial', 'index', 'predicate'],
  ['include', 'column', 'covering'],
  ['concurrent', 'index', 'not invalid'],
  ['exclusion', 'constraint', 'gist'],
  ['deferred', 'fkey', 'end transaction'],
]

const REPOS = ['dugout', 'handbook', 'workshop', 'foundry', 'atlas'] as const

export const FINDINGS: Finding[] = FINDING_ROWS.map(([head, tail, predicate], i) => {
  const topic = `${head} ${tail}`
  const key = `${head}-${tail}`
  return {
    key,
    topic,
    text: `The ${topic} is ${predicate}.`,
    repo: REPOS[i % REPOS.length]!,
    revision: (0x1000000 + i * 17).toString(16),
    jobId: `job_${key.replace(/-/g, '_')}`,
  }
})

const PARAPHRASE: Array<(f: Finding) => string> = [
  (f) => `what did Kernel find about ${f.topic}`,
  (f) => `what was Kernel finding about ${f.topic}`,
  (f) => `remember Kernel finding about ${f.topic}`,
  (f) => `what did Kernel find for ${f.topic}`,
  (f) => `Kernel last result about ${f.topic}`,
  (f) => `remember the Kernel finding for ${f.topic}`,
  (f) => `what did Kernel find from ${f.topic}`,
  (f) => `what was Kernel last job about ${f.topic}`,
  (f) => `what did Kernel find about the ${f.topic}`,
  (f) => `remember the Kernel finding about the ${f.topic}`,
]

const FOLLOWUP: Array<(f: Finding) => string> = [
  (f) => `why is ${f.text.slice(0, -1)}?`,
  (f) => `how should we change ${f.topic}?`,
  (f) => `does ${f.topic} still work today?`,
  (f) => `explain ${f.topic} in more detail`,
  (f) => `should we publish ${f.topic} today`,
  (f) => `what happens if ${f.topic} fails`,
]

const UNRELATED = [
  'Hello, what is your name?',
  'What is the weather in Chicago?',
  'How do I cook pasta?',
  'Tell me a joke.',
  'Good morning.',
  'What time is it?',
  'Can you help me pack a suitcase?',
  'Who won the World Series in 2016?',
  'How are you today?',
  'What is two plus two?',
  'Please summarize the news.',
  'Where should we eat lunch?',
  'Is it going to rain tomorrow?',
  'How long does sourdough take?',
  'What is the capital of Portugal?',
  'Can you recommend a book?',
  'How do I tune a guitar?',
  'Good night.',
  'Thanks for your time.',
  'Do you like coffee or tea?',
]

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

function pick<T>(items: readonly T[], i: number): T {
  return items[i % items.length]!
}

function pickWeighted(weights: number[], rng: () => number): number {
  let total = 0
  for (const w of weights) total += w
  let r = rng() * total
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i]!
    if (r <= 0) return i
  }
  return weights.length - 1
}

function morningWeightedPositions(n: number, k: number, latestExclusive: number, rng: () => number): Set<number> {
  if (k < 1) return new Set()
  const span = Math.max(k, Math.min(latestExclusive, n))
  const chosen = new Set<number>([0])
  const weights = Array.from({ length: span }, (_, i) => (span - i) ** 2)
  while (chosen.size < k) {
    const available: number[] = []
    const availW: number[] = []
    for (let i = 0; i < span; i += 1) {
      if (chosen.has(i)) continue
      available.push(i)
      availW.push(weights[i]!)
    }
    if (available.length === 0) break
    const idx = pickWeighted(availW, rng)
    chosen.add(available[idx]!)
  }
  return chosen
}

export type PlannedTurn = {
  query: string
  gold: GoldTurn
  persist?: RememberInput
}

export type MixCounts = {
  firstLook: number
  revisitParaphrase: number
  followup: number
  unrelated: number
  novelRate: number
}

export function mixFor(novelRate: number, turns = TURN_COUNT): MixCounts {
  const firstLook = Math.round(turns * novelRate)
  const followup = TAIL_FOLLOWUP
  const unrelated = TAIL_UNRELATED
  const revisitParaphrase = turns - firstLook - followup - unrelated
  if (firstLook < 1) throw new Error(`novelRate ${novelRate} yields no first-looks`)
  if (revisitParaphrase < 1) throw new Error(`novelRate ${novelRate} leaves no revisit slots`)
  if (firstLook > FINDINGS.length) throw new Error(`need ${firstLook} findings, have ${FINDINGS.length}`)
  return { firstLook, revisitParaphrase, followup, unrelated, novelRate }
}

export function planWorkdayTurns(seed = WORKDAY_EVAL_SEED, novelRate = PRIMARY_NOVEL_RATE): PlannedTurn[] {
  const rng = mulberry32(seed)
  const mix = mixFor(novelRate)
  const findings = shuffle(FINDINGS, rng).slice(0, mix.firstLook)
  const latestFirst = TURN_COUNT - WINDOW
  const firstIdx = morningWeightedPositions(TURN_COUNT, mix.firstLook, latestFirst, rng)
  const rest = shuffle(
    Array.from({ length: TURN_COUNT }, (_, i) => i).filter((i) => !firstIdx.has(i)),
    rng,
  )
  const followIdx = new Set(rest.slice(0, mix.followup))
  const unrelIdx = new Set(rest.slice(mix.followup, mix.followup + mix.unrelated))

  const persisted: Finding[] = []
  const revisitCounts = new Map<string, number>()
  const planned: PlannedTurn[] = []
  let nextFinding = 0
  let paraphraseCursor = 0
  let followCursor = 0
  let unrelCursor = 0

  const leastRevisited = (): Finding => {
    let best = persisted[0]!
    let bestN = revisitCounts.get(best.key) ?? 0
    for (const f of persisted) {
      const n = revisitCounts.get(f.key) ?? 0
      if (n < bestN) {
        best = f
        bestN = n
      }
    }
    const tied = persisted.filter((f) => (revisitCounts.get(f.key) ?? 0) === bestN)
    return tied[Math.floor(rng() * tied.length)]!
  }

  for (let i = 0; i < TURN_COUNT; i += 1) {
    const mustFirst = persisted.length === 0 || firstIdx.has(i)
    if (mustFirst) {
      const finding = findings[nextFinding]
      if (!finding) throw new Error(`first-look ${nextFinding} past finding catalog`)
      nextFinding += 1
      const query = pick(PARAPHRASE, paraphraseCursor)(finding)
      paraphraseCursor += 1
      planned.push({
        query,
        gold: { expect: 'miss', reason: 'first-look', claimId: finding.key },
        persist: asRemember(finding),
      })
      persisted.push(finding)
      continue
    }
    if (followIdx.has(i)) {
      const finding = leastRevisited()
      planned.push({
        query: pick(FOLLOWUP, followCursor)(finding),
        gold: { expect: 'miss', reason: 'followup', claimId: finding.key },
      })
      followCursor += 1
      continue
    }
    if (unrelIdx.has(i)) {
      planned.push({
        query: pick(UNRELATED, unrelCursor),
        gold: { expect: 'miss', reason: 'unrelated' },
      })
      unrelCursor += 1
      continue
    }
    const finding = leastRevisited()
    const query = pick(PARAPHRASE, paraphraseCursor)(finding)
    paraphraseCursor += 1
    planned.push({
      query,
      gold: { expect: 'hit', reason: 'revisit-paraphrase', claimId: finding.key },
    })
    revisitCounts.set(finding.key, (revisitCounts.get(finding.key) ?? 0) + 1)
  }

  if (planned.length !== TURN_COUNT) throw new Error(`planned ${planned.length}, need ${TURN_COUNT}`)
  if (nextFinding !== mix.firstLook) throw new Error(`placed ${nextFinding} first-looks, need ${mix.firstLook}`)

  const products = ['Kernel', 'Research']
  for (const row of planned) {
    const kind = jobKindForKit('coordinator', row.query, '', products)
    if (kind) throw new Error(`query books ${kind}, not staff chat: ${JSON.stringify(row.query)}`)
  }
  return planned
}

export type WorkdayEvalTurnRow = {
  n: number
  query: string
  outcome: 'hit' | 'miss'
  inferenceAvoided: boolean
  inferenceAttempted: boolean
  chatCalls: number
  costUsd: number
  spoken: string
  servedClaimId?: string
  servedRevision?: string
  servedRepo?: string
  servedFreshness?: string
  falseHit: boolean
  staleHit: boolean
  gold: GoldTurn
}

export type SeriesPoint = {
  n: number
  cumulativeAvoidance: number
  hitsSoFar: number
  missesSoFar: number
}

export type WindowStats = {
  start: number
  end: number
  turns: number
  hits: number
  misses: number
  avoidance: number
}

export type RateSummary = {
  novelRate: number
  turns: number
  firstLooks: number
  avoidance: number
  falseHitRate: number
  staleHitRate: number
  inferenceCalls: number
  inferenceAvoided: number
  costUsd: number
  hits: number
  misses: number
  falseHits: number
  staleHits: number
  earlyAvoidance: number
  lateAvoidance: number
}

export type WorkdayEvalSummary = RateSummary & {
  notes: string
}

export type WorkdayEvalLedger = {
  workload: {
    description: string
    seed: number
    turns: number
    novelRate: number
    novelRates: number[]
    mix: MixCounts
    interpretation: string
    liveMixedLedger: { hits: number; turns: number; note: string }
    repeatedWorkReplay: { hits: number; turns: number; note: string }
    toughEval: {
      turns: number
      hits: number
      avoidance: number
      falseHits: number
      staleHits: number
      costUsd: number
      inferenceCalls: number
      note: string
    }
    gates: string[]
  }
  turns: WorkdayEvalTurnRow[]
  series: SeriesPoint[]
  windows: { early: WindowStats; late: WindowStats }
  summary: WorkdayEvalSummary
  byNovelRate: Record<string, RateSummary>
  store: { path: string; liveHomeStore: false }
  gitSha: string
  capturedAt: string
  ledger: LedgerMetrics
}

export type WorkdayEvalSpec = {
  seed: number
  turns: number
  primaryNovelRate: number
  novelRates: number[]
  mix: MixCounts
  description: string
  interpretation: string
  run: string
  gates: string[]
  claims: string
  turnsPlanned: Array<{ n: number; query: string; gold: GoldTurn }>
}

export const DEFAULT_LEDGER_PATH = join(PRODUCT_ROOT, 'artifacts', 'workday-eval-ledger.json')
export const DEFAULT_SPEC_PATH = join(PRODUCT_ROOT, 'artifacts', 'workday-eval-spec.json')

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

function scoreTurn(input: {
  gold: GoldTurn
  outcome: 'hit' | 'miss'
  spoken: string
  claims: { id: string; text: string; ownerAgentId: string; repo?: string; revision?: string; freshness: string }[]
}): {
  falseHit: boolean
  staleHit: boolean
  servedClaimId?: string
  servedRevision?: string
  servedRepo?: string
  servedFreshness?: string
} {
  if (input.outcome !== 'hit') {
    return { falseHit: false, staleHit: false }
  }
  const served = input.claims.find((row) => row.text === input.spoken)
  const staleHit = served?.freshness === 'stale'
  let falseHit = false
  if (!served) falseHit = true
  else if (input.gold.expect === 'miss') falseHit = true
  else if (input.gold.claimId) {
    const finding = FINDINGS.find((row) => row.key === input.gold.claimId)
    if (finding && served.text !== finding.text) falseHit = true
  } else if (served.ownerAgentId !== 'kernel') falseHit = true
  return {
    falseHit,
    staleHit,
    servedClaimId: served?.id,
    servedRevision: served?.revision,
    servedRepo: served?.repo,
    servedFreshness: served?.freshness,
  }
}

function windowStats(turns: WorkdayEvalTurnRow[], startN: number, endN: number): WindowStats {
  const slice = turns.filter((row) => row.n >= startN && row.n <= endN)
  const hits = slice.filter((row) => row.outcome === 'hit').length
  const misses = slice.length - hits
  return {
    start: startN,
    end: endN,
    turns: slice.length,
    hits,
    misses,
    avoidance: slice.length === 0 ? 0 : hits / slice.length,
  }
}

async function playTurn(input: {
  session: Session
  store: ReturnType<typeof openStaffStore>
  query: string
  chat: ChatFn
  chatCalls: { n: number }
}): Promise<{
  session: Session
  outcome: 'hit' | 'miss'
  spoken: string
  chatCalls: number
  costUsd: number
  inferenceAvoided: boolean
  inferenceAttempted: boolean
}> {
  const before = input.chatCalls.n
  let session = send(input.session, input.query)
  const turn = pendingMouthTurns(session)[0]
  if (!turn) throw new Error(`no pending mouth turn for ${JSON.stringify(input.query)}`)
  if (turn.agentId !== 'staff' || turn.mode !== 'chat') {
    throw new Error(`expected staff chat turn, got ${turn.agentId}/${turn.mode} for ${JSON.stringify(input.query)}`)
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
    outcome: receipt.outcome,
    spoken,
    chatCalls: input.chatCalls.n - before,
    costUsd: receipt.costUsd ?? 0,
    inferenceAvoided: receipt.inferenceAvoided,
    inferenceAttempted: receipt.inferenceAttempted,
  }
}

function rateSummary(input: {
  novelRate: number
  firstLooks: number
  turns: WorkdayEvalTurnRow[]
  ledger: LedgerMetrics
}): RateSummary {
  const falseHits = input.turns.filter((row) => row.falseHit).length
  const staleHits = input.turns.filter((row) => row.staleHit).length
  const costUsd = input.turns.reduce((sum, row) => sum + row.costUsd, 0)
  const early = windowStats(input.turns, 1, WINDOW)
  const late = windowStats(input.turns, input.turns.length - WINDOW + 1, input.turns.length)
  return {
    novelRate: input.novelRate,
    turns: input.turns.length,
    firstLooks: input.firstLooks,
    avoidance: input.turns.length === 0 ? 0 : input.ledger.inferenceAvoided / input.turns.length,
    falseHitRate: input.turns.length === 0 ? 0 : falseHits / input.turns.length,
    staleHitRate: input.turns.length === 0 ? 0 : staleHits / input.turns.length,
    inferenceCalls: input.ledger.inferenceCalls,
    inferenceAvoided: input.ledger.inferenceAvoided,
    costUsd,
    hits: input.ledger.hits,
    misses: input.ledger.misses,
    falseHits,
    staleHits,
    earlyAvoidance: early.avoidance,
    lateAvoidance: late.avoidance,
  }
}

export async function runWorkdayEval(input?: {
  storePath?: string
  dest?: string | null
  specDest?: string | null
  seed?: number
  novelRate?: number
  sweepRates?: readonly number[]
}): Promise<WorkdayEvalLedger> {
  const seed = input?.seed ?? WORKDAY_EVAL_SEED
  const novelRate = input?.novelRate ?? PRIMARY_NOVEL_RATE
  const primary = await runOneWorkday({
    storePath: input?.storePath,
    seed,
    novelRate,
  })

  const byNovelRate: Record<string, RateSummary> = {
    [String(novelRate)]: {
      novelRate: primary.summary.novelRate,
      turns: primary.summary.turns,
      firstLooks: primary.summary.firstLooks,
      avoidance: primary.summary.avoidance,
      falseHitRate: primary.summary.falseHitRate,
      staleHitRate: primary.summary.staleHitRate,
      inferenceCalls: primary.summary.inferenceCalls,
      inferenceAvoided: primary.summary.inferenceAvoided,
      costUsd: primary.summary.costUsd,
      hits: primary.summary.hits,
      misses: primary.summary.misses,
      falseHits: primary.summary.falseHits,
      staleHits: primary.summary.staleHits,
      earlyAvoidance: primary.summary.earlyAvoidance,
      lateAvoidance: primary.summary.lateAvoidance,
    },
  }

  const sweep = input?.sweepRates
  if (sweep) {
    for (const rate of sweep) {
      if (rate === novelRate) continue
      const extra = await runOneWorkday({ seed, novelRate: rate })
      byNovelRate[String(rate)] = {
        novelRate: extra.summary.novelRate,
        turns: extra.summary.turns,
        firstLooks: extra.summary.firstLooks,
        avoidance: extra.summary.avoidance,
        falseHitRate: extra.summary.falseHitRate,
        staleHitRate: extra.summary.staleHitRate,
        inferenceCalls: extra.summary.inferenceCalls,
        inferenceAvoided: extra.summary.inferenceAvoided,
        costUsd: extra.summary.costUsd,
        hits: extra.summary.hits,
        misses: extra.summary.misses,
        falseHits: extra.summary.falseHits,
        staleHits: extra.summary.staleHits,
        earlyAvoidance: extra.summary.earlyAvoidance,
        lateAvoidance: extra.summary.lateAvoidance,
      }
    }
  }

  const report: WorkdayEvalLedger = { ...primary, byNovelRate }

  if (input?.dest !== null) {
    writeWorkdayEvalLedger(report, input?.dest ?? DEFAULT_LEDGER_PATH)
  }
  if (input?.specDest !== null) {
    writeWorkdayEvalSpec(report, input?.specDest ?? DEFAULT_SPEC_PATH, seed, novelRate)
  }
  return report
}

async function runOneWorkday(input: {
  storePath?: string
  seed: number
  novelRate: number
}): Promise<WorkdayEvalLedger> {
  resetIdsForTests()
  resetMouthForTests()
  const storePath = input.storePath ?? join(tmpdir(), `automaton-workday-eval-${Date.now()}-${input.novelRate}.sqlite`)
  if (storePath.includes('.automaton/staff.sqlite')) {
    throw new Error('refusing to touch ~/.automaton/staff.sqlite')
  }
  const store = openStaffStore(storePath)
  if (store.listClaims().length !== 0) {
    throw new Error('workday eval must start from an empty store')
  }
  const chatCalls = { n: 0 }
  const chat: ChatFn = async () => {
    chatCalls.n += 1
    return {
      text: 'Staff. Paid miss.',
      usage: { promptTokens: 11, completionTokens: 4, costUsd: MISS_COST_USD },
    }
  }

  let session = emptySession()
  const planned = planWorkdayTurns(input.seed, input.novelRate)
  const turns: WorkdayEvalTurnRow[] = []
  const series: SeriesPoint[] = []
  let hitsSoFar = 0
  let missesSoFar = 0

  for (const [i, row] of planned.entries()) {
    const claimsBefore = store.listClaims().length
    const played = await playTurn({
      session,
      store,
      query: row.query,
      chat,
      chatCalls,
    })
    session = played.session
    if (row.gold.reason === 'first-look') {
      if (store.listClaims().length !== claimsBefore) {
        throw new Error('chat miss auto-remembered; Automaton must not persist a mouth miss as a claim')
      }
      if (!row.persist) throw new Error(`first-look ${row.gold.claimId} missing persist payload`)
      store.remember(row.persist)
    }
    const scored = scoreTurn({
      gold: row.gold,
      outcome: played.outcome,
      spoken: played.spoken,
      claims: store.listClaims(),
    })
    const turnRow: WorkdayEvalTurnRow = {
      n: i + 1,
      query: row.query,
      outcome: played.outcome,
      inferenceAvoided: played.inferenceAvoided,
      inferenceAttempted: played.inferenceAttempted,
      chatCalls: played.chatCalls,
      costUsd: played.costUsd,
      spoken: played.spoken,
      ...scored,
      gold: row.gold,
    }
    turns.push(turnRow)
    if (played.outcome === 'hit') hitsSoFar += 1
    else missesSoFar += 1
    series.push({
      n: i + 1,
      cumulativeAvoidance: hitsSoFar / (i + 1),
      hitsSoFar,
      missesSoFar,
    })
  }

  const ledger = store.metrics()
  const mix = mixFor(input.novelRate)
  const summaryBase = rateSummary({
    novelRate: input.novelRate,
    firstLooks: mix.firstLook,
    turns,
    ledger,
  })
  const early = windowStats(turns, 1, WINDOW)
  const late = windowStats(turns, turns.length - WINDOW + 1, turns.length)
  const summary: WorkdayEvalSummary = {
    ...summaryBase,
    notes: INTERPRETATION,
  }

  return {
    workload: {
      description: WORKLOAD_DESCRIPTION,
      seed: input.seed,
      turns: turns.length,
      novelRate: input.novelRate,
      novelRates: [...NOVEL_RATES],
      mix,
      interpretation: INTERPRETATION,
      liveMixedLedger: {
        hits: 1,
        turns: 51,
        note: 'Cary Palmer live ~/.automaton/staff.sqlite is 1 hit / 51 turns. That is an early mixed desk, not a full workday on one domain.',
      },
      repeatedWorkReplay: {
        hits: 19,
        turns: 20,
        note: '19/20 (95%) is the single-finding limit: 1 miss + 19 hits of one stored Kernel claim.',
      },
      toughEval: {
        turns: 330,
        hits: 83,
        avoidance: 83 / 330,
        falseHits: 0,
        staleHits: 0,
        costUsd: 0.247,
        inferenceCalls: 247,
        note: 'Hostile mix: 330 turns, 83/330 = 25.15% avoidance, 0 false hits, 0 stale hits, $0.247, 247 calls. Safety score of the gates, not a retraction of the workday 95%.',
      },
      gates: ['RECALL_REQUEST', 'uniqueSpeakable', 'skip stale', 'taskKey', 'owner'],
    },
    turns,
    series,
    windows: { early, late },
    summary,
    byNovelRate: {},
    store: { path: storePath, liveHomeStore: false },
    gitSha: gitSha(),
    capturedAt: new Date().toISOString(),
    ledger,
  }
}

export function writeWorkdayEvalLedger(report: WorkdayEvalLedger, dest = DEFAULT_LEDGER_PATH): void {
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`)
}

export function writeWorkdayEvalSpec(
  report: WorkdayEvalLedger,
  dest = DEFAULT_SPEC_PATH,
  seed = WORKDAY_EVAL_SEED,
  novelRate = PRIMARY_NOVEL_RATE,
): void {
  const spec: WorkdayEvalSpec = {
    seed,
    turns: report.summary.turns,
    primaryNovelRate: novelRate,
    novelRates: [...NOVEL_RATES],
    mix: report.workload.mix,
    description: WORKLOAD_DESCRIPTION,
    interpretation: INTERPRETATION,
    run: 'From the Automaton checkout: bun scripts/replay-workday-eval.ts',
    gates: report.workload.gates,
    claims: 'Empty start. After each first-look miss, persist a job-sourced Kernel claim (chat misses do not remember()).',
    turnsPlanned: report.turns.map((row) => ({
      n: row.n,
      query: row.query,
      gold: row.gold,
    })),
  }
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(spec, null, 2)}\n`)
}

if (import.meta.main) {
  const report = await runWorkdayEval({ sweepRates: NOVEL_RATES })
  const { summary, windows, byNovelRate } = report
  const sweep = NOVEL_RATES.map((rate) => {
    const row = byNovelRate[String(rate)]
    if (!row) return `${(rate * 100).toFixed(0)}%=missing`
    return `${(rate * 100).toFixed(0)}%=${row.avoidance.toFixed(4)}`
  }).join(' ')
  console.log(
    `workday-eval turns=${summary.turns} novelRate=${summary.novelRate} firstLooks=${summary.firstLooks} avoidance=${summary.avoidance.toFixed(4)} early=${windows.early.avoidance.toFixed(4)} late=${windows.late.avoidance.toFixed(4)} falseHitRate=${summary.falseHitRate.toFixed(4)} staleHitRate=${summary.staleHitRate.toFixed(4)} inferenceCalls=${summary.inferenceCalls} costUsd=${summary.costUsd.toFixed(4)} sweep ${sweep} sha=${report.gitSha}`,
  )
}
