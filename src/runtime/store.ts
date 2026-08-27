import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { automatonHome } from './keys'
import {
  asGoalBlockerSource,
  boundGoalEvidence,
  peekIdSeq,
  restoreIdSeq,
  sessionGoals,
  type AgentId,
  type GoalEventSource,
  type GoalReceipt,
  type GoalRun,
} from '../domain'
import { normalizeSession, type Session } from '../session'
import type { Attachment, AttachmentInput } from './attachments'
import {
  asArtifactKind,
  asClaimFreshness,
  queryTokens,
  type ArtifactKind,
  type Claim,
  type ClaimFreshness,
  type ClaimSource,
} from './working-set'

export type { Attachment, AttachmentInput } from './attachments'

export { queryTokens } from './working-set'

export function defaultStorePath(): string {
  return join(automatonHome(), 'staff.sqlite')
}

export type RememberInput = {
  ownerAgentId: AgentId
  text: string
  source: ClaimSource
  jobId?: string
  taskKey?: string
  repo?: string
  revision?: string
  artifactKind?: ArtifactKind
  freshness?: ClaimFreshness
}

export type TurnOutcome = 'hit' | 'miss'
export type TurnStatus = 'complete' | 'failed'

export type TurnReceipt = {
  userItemId: string
  outcome: TurnOutcome
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  inferenceAvoided: boolean
  inferenceAttempted: boolean
  status: TurnStatus
}

export type LedgerMetrics = {
  turns: number
  hits: number
  misses: number
  inferenceAvoided: number
  inferenceCalls: number
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  promptTokensKnown: number
  promptTokensUnknown: number
  completionTokensKnown: number
  completionTokensUnknown: number
  costKnown: number
  costUnknown: number
}

export type GoalEventKind =
  | 'opened'
  | 'booked'
  | 'waiting_external'
  | 'waiting_user'
  | 'receipt_ok'
  | 'receipt_fail'
  | 'retry'
  | 'cancelled'
  | 'complete'
  | 'failed'

/** Under what authority a GoalRun transition was recorded. Source stays actor/provenance. */
export type GoalEventAuthority =
  | 'user_request'
  | 'goal_policy'
  | 'worker_result'
  | 'operator_action'
  | 'external_state'

export type { GoalEventSource }

export type GoalEvent = {
  id: string
  goalId: string
  criterionId?: string
  jobId?: string
  kind: GoalEventKind
  source: GoalEventSource
  authority: GoalEventAuthority
  reason: string
  at: number
}

export type StaffStore = {
  path: string
  save(session: Session): void
  load(): Session | null
  listGoalEvents(goalId?: string, limit?: number): GoalEvent[]
  remember(input: RememberInput): void
  recall(query: string, limit?: number): Claim[]
  listClaims(): Claim[]
  recordReceipt(receipt: TurnReceipt): void
  receipt(userItemId: string): TurnReceipt | null
  metrics(): LedgerMetrics
  recordAttachment(input: AttachmentInput): void
  bindAttachments(ids: string[], itemId: string): void
  attachmentsForItem(itemId: string): Attachment[]
  listAttachments(ownerAgentId?: string): Attachment[]
}

type ReceiptRow = {
  user_item_id: string
  outcome: string
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  cost_usd: number | null
  inference_avoided: number
  inference_attempted: number
  status: string
}

function tableColumns(db: Database, table: string): Set<string> {
  return new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name),
  )
}

function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      session_json TEXT NOT NULL,
      id_seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turn_receipts (
      user_item_id TEXT PRIMARY KEY,
      outcome TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cost_usd REAL,
      inference_avoided INTEGER NOT NULL,
      inference_attempted INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      owner_agent_id TEXT NOT NULL,
      item_id TEXT,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      mime TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_events (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      criterion_id TEXT,
      job_id TEXT,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      authority TEXT NOT NULL,
      reason TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS goal_events_goal_at ON goal_events (goal_id, at, id);
  `)
  const eventCols = tableColumns(db, 'goal_events')
  if (!eventCols.has('authority')) {
    db.exec(`
      ALTER TABLE goal_events ADD COLUMN authority TEXT NOT NULL DEFAULT 'goal_policy';
      UPDATE goal_events SET authority = CASE
        WHEN kind = 'opened' THEN 'user_request'
        WHEN kind IN ('retry', 'cancelled') THEN 'operator_action'
        WHEN kind IN ('receipt_ok', 'receipt_fail', 'failed') THEN 'worker_result'
        WHEN kind = 'waiting_external' THEN 'external_state'
        WHEN kind = 'waiting_user' AND source IN ('host', 'job') THEN 'external_state'
        ELSE 'goal_policy'
      END;
    `)
  }
  const cols = tableColumns(db, 'claims')
  if (!cols.has('source')) {
    db.exec(`ALTER TABLE claims ADD COLUMN source TEXT NOT NULL DEFAULT 'mouth'`)
  }
  if (!cols.has('job_id')) {
    db.exec(`ALTER TABLE claims ADD COLUMN job_id TEXT`)
  }
  if (!cols.has('task_key')) {
    db.exec(`ALTER TABLE claims ADD COLUMN task_key TEXT`)
  }
  if (!cols.has('repo')) {
    db.exec(`ALTER TABLE claims ADD COLUMN repo TEXT`)
  }
  if (!cols.has('revision')) {
    db.exec(`ALTER TABLE claims ADD COLUMN revision TEXT`)
  }
  if (!cols.has('artifact_kind')) {
    db.exec(`ALTER TABLE claims ADD COLUMN artifact_kind TEXT`)
  }
  if (!cols.has('freshness')) {
    db.exec(`ALTER TABLE claims ADD COLUMN freshness TEXT NOT NULL DEFAULT 'unknown'`)
  }
  const receiptCols = tableColumns(db, 'turn_receipts')
  if (!receiptCols.has('inference_attempted')) {
    db.exec(`ALTER TABLE turn_receipts ADD COLUMN inference_attempted INTEGER NOT NULL DEFAULT 0`)
  }
  db.exec(`
    DELETE FROM claims WHERE id NOT IN (
      SELECT MIN(id) FROM claims GROUP BY
        owner_agent_id, source, ifnull(job_id, ''), ifnull(task_key, ''),
        ifnull(repo, ''), ifnull(revision, ''), ifnull(artifact_kind, ''), text
    );
    DROP INDEX IF EXISTS claims_idempotent;
    CREATE UNIQUE INDEX IF NOT EXISTS claims_idempotent
      ON claims (
        owner_agent_id, source, ifnull(job_id, ''), ifnull(task_key, ''),
        ifnull(repo, ''), ifnull(revision, ''), ifnull(artifact_kind, ''), text
      );
  `)
}

type ClaimRow = {
  id: number | string
  owner_agent_id: string
  text: string
  source: string
  job_id: string | null
  task_key: string | null
  repo: string | null
  revision: string | null
  artifact_kind: string | null
  freshness: string | null
}

const CLAIM_COLUMNS =
  'id, owner_agent_id, text, source, job_id, task_key, repo, revision, artifact_kind, freshness'

function asClaim(row: ClaimRow): Claim {
  return {
    id: String(row.id),
    ownerAgentId: row.owner_agent_id,
    text: row.text,
    source: row.source === 'job' ? 'job' : 'mouth',
    jobId: row.job_id || undefined,
    taskKey: row.task_key || undefined,
    repo: row.repo || undefined,
    revision: row.revision || undefined,
    artifactKind: asArtifactKind(row.artifact_kind),
    freshness: asClaimFreshness(row.freshness),
  }
}

function asAttachment(row: {
  id: string
  owner_agent_id: string
  item_id: string | null
  path: string
  hash: string
  mime: string
  kind: string
}): Attachment {
  return {
    id: row.id,
    ownerAgentId: row.owner_agent_id,
    itemId: row.item_id || undefined,
    path: row.path,
    hash: row.hash,
    mime: row.mime,
    kind: row.kind === 'image' ? 'image' : 'file',
  }
}

type GoalEventRow = {
  id: string
  goal_id: string
  criterion_id: string | null
  job_id: string | null
  kind: string
  source: string
  authority: string | null
  reason: string
  at: number
}

const GOAL_EVENT_KINDS = new Set<GoalEventKind>([
  'opened',
  'booked',
  'waiting_external',
  'waiting_user',
  'receipt_ok',
  'receipt_fail',
  'retry',
  'cancelled',
  'complete',
  'failed',
])

const GOAL_EVENT_SOURCES = new Set<GoalEventSource>(['staff', 'user', 'job', 'host'])

const GOAL_EVENT_AUTHORITIES = new Set<GoalEventAuthority>([
  'user_request',
  'goal_policy',
  'worker_result',
  'operator_action',
  'external_state',
])

function asGoalEventKind(value: string): GoalEventKind | null {
  return GOAL_EVENT_KINDS.has(value as GoalEventKind) ? (value as GoalEventKind) : null
}

function asGoalEventSource(value: string): GoalEventSource {
  return GOAL_EVENT_SOURCES.has(value as GoalEventSource) ? (value as GoalEventSource) : 'staff'
}

function authorityForEvent(kind: GoalEventKind, source: GoalEventSource): GoalEventAuthority {
  if (kind === 'opened') return 'user_request'
  if (kind === 'retry' || kind === 'cancelled') return 'operator_action'
  if (kind === 'receipt_ok' || kind === 'receipt_fail' || kind === 'failed') return 'worker_result'
  if (kind === 'waiting_external') return 'external_state'
  if (kind === 'waiting_user') {
    return source === 'host' || source === 'job' ? 'external_state' : 'goal_policy'
  }
  return 'goal_policy'
}

function asGoalEventAuthority(
  value: string | null | undefined,
  kind: GoalEventKind,
  source: GoalEventSource,
): GoalEventAuthority {
  if (value && GOAL_EVENT_AUTHORITIES.has(value as GoalEventAuthority)) {
    return value as GoalEventAuthority
  }
  return authorityForEvent(kind, source)
}

function asGoalEvent(row: GoalEventRow): GoalEvent | null {
  const kind = asGoalEventKind(row.kind)
  if (!kind) return null
  const source = asGoalEventSource(row.source)
  return {
    id: row.id,
    goalId: row.goal_id,
    criterionId: row.criterion_id || undefined,
    jobId: row.job_id || undefined,
    kind,
    source,
    authority: asGoalEventAuthority(row.authority, kind, source),
    reason: row.reason,
    at: row.at,
  }
}

function eventRow(
  id: string,
  goalId: string,
  kind: GoalEventKind,
  source: GoalEventSource,
  reason: string,
  at: number,
  criterionId?: string,
  jobId?: string,
): GoalEvent {
  return {
    id,
    goalId,
    criterionId,
    jobId,
    kind,
    source,
    authority: authorityForEvent(kind, source),
    reason: boundGoalEvidence(reason),
    at,
  }
}

function goalJob(session: Session, goalId: string, criterionId?: string) {
  const matches = session.jobs.filter((job) => {
    if (job.goalId !== goalId) return false
    if (criterionId && job.criterionId !== criterionId) return false
    return true
  })
  const running = matches.filter((job) => job.status === 'running')
  if (running.length > 0) return running[running.length - 1]
  const waiting = matches.filter((job) => job.status === 'waiting')
  if (waiting.length > 0) return waiting[waiting.length - 1]
  return matches[matches.length - 1]
}

function receiptEvents(prior: GoalRun | undefined, next: GoalRun): GoalEvent[] {
  const seen = new Set((prior?.receipts ?? []).map((row) => row.id))
  return next.receipts.flatMap((receipt: GoalReceipt) => {
    if (seen.has(receipt.id)) return []
    return [
      eventRow(
        `receipt:${receipt.id}`,
        next.id,
        receipt.ok ? 'receipt_ok' : 'receipt_fail',
        'job',
        receipt.spoken,
        receipt.at,
        receipt.criterionId,
        receipt.jobId,
      ),
    ]
  })
}

/** Newly observed GoalRun facts. Deterministic ids keep repeated saves idempotent. */
export function goalEventsFromSessions(prior: Session | null, next: Session): GoalEvent[] {
  const beforeGoals = new Map(sessionGoals(prior?.goals).map((goal) => [goal.id, goal]))
  const beforeJobs = new Map((prior?.jobs ?? []).map((job) => [job.id, job]))
  const events: GoalEvent[] = []
  let stamp = Date.now()
  const at = () => {
    stamp += 1
    return stamp
  }

  for (const goal of sessionGoals(next.goals)) {
    const before = beforeGoals.get(goal.id)
    if (!before) {
      events.push(eventRow(`opened:${goal.id}`, goal.id, 'opened', 'staff', goal.text, at()))
    }
    const fresh = next.jobs.filter((job) => job.goalId === goal.id && !beforeJobs.has(job.id))
    const replacement = fresh.find((job) => job.status === 'running')
    if (before?.status === 'waiting_user' && replacement) {
      events.push(
        eventRow(
          `retry:${replacement.id}`,
          goal.id,
          'retry',
          'user',
          replacement.goal,
          at(),
          replacement.criterionId,
          replacement.id,
        ),
      )
    }
    for (const job of fresh) {
      events.push(
        eventRow(`booked:${job.id}`, goal.id, 'booked', 'staff', job.goal, at(), job.criterionId, job.id),
      )
    }
    if (goal.status === 'waiting_external' && before?.status !== 'waiting_external') {
      const job = goalJob(next, goal.id, goal.activeCriterionId)
      events.push(
        eventRow(
          `waiting_external:${goal.id}:${job?.id ?? goal.activeCriterionId ?? 'goal'}`,
          goal.id,
          'waiting_external',
          'host',
          'Waiting for required checks.',
          at(),
          goal.activeCriterionId,
          job?.id,
        ),
      )
    }
    if (goal.status === 'waiting_user' && goal.blocker) {
      const blockerId = `waiting_user:${goal.id}:${goal.blocker.jobId ?? goal.blocker.criterionId}`
      const same =
        before?.status === 'waiting_user' &&
        before.blocker &&
        `waiting_user:${before.id}:${before.blocker.jobId ?? before.blocker.criterionId}` === blockerId
      if (!same) {
        events.push(
          eventRow(
            blockerId,
            goal.id,
            'waiting_user',
            asGoalBlockerSource(goal.blocker.source),
            goal.blocker.reason,
            goal.blocker.at,
            goal.blocker.criterionId,
            goal.blocker.jobId,
          ),
        )
      }
    }
    events.push(...receiptEvents(before, goal))
    if (goal.status === 'cancelled' && before?.status !== 'cancelled') {
      events.push(
        eventRow(
          `cancelled:${goal.id}`,
          goal.id,
          'cancelled',
          'user',
          goal.text,
          at(),
          before.blocker?.criterionId ?? before.activeCriterionId,
          before.blocker?.jobId,
        ),
      )
    }
    if (goal.status === 'complete' && before?.status !== 'complete') {
      events.push(eventRow(`complete:${goal.id}`, goal.id, 'complete', 'staff', goal.text, at()))
    }
    if (goal.status === 'failed' && before?.status !== 'failed') {
      events.push(eventRow(`failed:${goal.id}`, goal.id, 'failed', 'job', goal.text, at()))
    }
  }
  return events
}

function asReceipt(row: ReceiptRow): TurnReceipt {
  return {
    userItemId: row.user_item_id,
    outcome: row.outcome === 'hit' ? 'hit' : 'miss',
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    inferenceAvoided: row.inference_avoided === 1,
    inferenceAttempted: row.inference_attempted === 1,
    status: row.status === 'failed' ? 'failed' : 'complete',
  }
}

function sumKnown(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function aggregateField(
  attempted: TurnReceipt[],
  read: (row: TurnReceipt) => number | null,
): { total: number | null; known: number; unknown: number } {
  const known = attempted.filter((row) => read(row) != null).map((row) => read(row) as number)
  const unknown = attempted.length - known.length
  return {
    total: unknown === 0 ? sumKnown(known) : null,
    known: known.length,
    unknown,
  }
}

export function openStaffStore(path = defaultStorePath()): StaffStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  ensureSchema(db)
  return {
    path,
    save(session) {
      const persist = db.transaction((next: Session) => {
        const row = db.query('SELECT session_json FROM snapshot WHERE id = 1').get() as
          | { session_json: string }
          | null
        const prior = row ? normalizeSession(JSON.parse(row.session_json) as Session) : null
        for (const event of goalEventsFromSessions(prior, next)) {
          db.run(
            `INSERT OR IGNORE INTO goal_events (
              id, goal_id, criterion_id, job_id, kind, source, authority, reason, at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.id,
              event.goalId,
              event.criterionId ?? null,
              event.jobId ?? null,
              event.kind,
              event.source,
              event.authority,
              event.reason,
              event.at,
            ],
          )
        }
        db.run('INSERT OR REPLACE INTO snapshot (id, session_json, id_seq) VALUES (1, ?, ?)', [
          JSON.stringify(next),
          peekIdSeq(),
        ])
      })
      persist(session)
    },
    load() {
      const row = db.query('SELECT session_json, id_seq FROM snapshot WHERE id = 1').get() as
        | { session_json: string; id_seq: number }
        | null
      if (!row) return null
      restoreIdSeq(row.id_seq)
      return normalizeSession(JSON.parse(row.session_json) as Session)
    },
    listGoalEvents(goalId, limit = 100) {
      const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100
      const rows = (
        goalId
          ? (db
              .query(
                `SELECT id, goal_id, criterion_id, job_id, kind, source, authority, reason, at
                 FROM goal_events WHERE goal_id = ? ORDER BY rowid ASC LIMIT ?`,
              )
              .all(goalId, cap) as GoalEventRow[])
          : (db
              .query(
                `SELECT id, goal_id, criterion_id, job_id, kind, source, authority, reason, at
                 FROM goal_events ORDER BY rowid ASC LIMIT ?`,
              )
              .all(cap) as GoalEventRow[])
      )
      return rows.flatMap((row) => {
        const event = asGoalEvent(row)
        return event ? [event] : []
      })
    },
    remember(input) {
      const cleaned = input.text.trim()
      if (!cleaned) return
      const source: ClaimSource = input.source === 'job' ? 'job' : 'mouth'
      const jobId = input.jobId?.trim() || null
      const taskKey = input.taskKey?.trim() || null
      const repo = input.repo?.trim() || null
      const revision = input.revision?.trim() || null
      const artifactKind = asArtifactKind(input.artifactKind) ?? null
      const freshness = asClaimFreshness(input.freshness)
      db.run(
        `INSERT OR IGNORE INTO claims (
          owner_agent_id, text, source, job_id, task_key, repo, revision, artifact_kind, freshness, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.ownerAgentId,
          cleaned,
          source,
          jobId,
          taskKey,
          repo,
          revision,
          artifactKind,
          freshness,
          new Date().toISOString(),
        ],
      )
    },
    recall(query, limit = 8) {
      const { owners, content } = queryTokens(query)
      if (owners.length === 0 && content.length === 0) return []
      const rows = db
        .query(`SELECT ${CLAIM_COLUMNS} FROM claims ORDER BY id DESC`)
        .all() as ClaimRow[]
      const matched = rows.map(asClaim).filter((claim) => {
        if (owners.length > 0 && !owners.includes(claim.ownerAgentId)) return false
        if (content.length === 0) return true
        const hay = claim.text.toLowerCase()
        return content.some((token) => hay.includes(token))
      })
      return matched.slice(0, limit)
    },
    listClaims() {
      const rows = db
        .query(`SELECT ${CLAIM_COLUMNS} FROM claims ORDER BY id ASC`)
        .all() as ClaimRow[]
      return rows.map(asClaim)
    },
    recordReceipt(receipt) {
      const userItemId = receipt.userItemId.trim()
      if (!userItemId) return
      db.run(
        `INSERT OR REPLACE INTO turn_receipts (
          user_item_id, outcome, model, prompt_tokens, completion_tokens, cost_usd,
          inference_avoided, inference_attempted, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userItemId,
          receipt.outcome,
          receipt.model,
          receipt.promptTokens,
          receipt.completionTokens,
          receipt.costUsd,
          receipt.inferenceAvoided ? 1 : 0,
          receipt.inferenceAttempted ? 1 : 0,
          receipt.status,
          new Date().toISOString(),
        ],
      )
    },
    receipt(userItemId) {
      const row = db
        .query(
          `SELECT user_item_id, outcome, model, prompt_tokens, completion_tokens, cost_usd,
                  inference_avoided, inference_attempted, status
           FROM turn_receipts WHERE user_item_id = ?`,
        )
        .get(userItemId) as ReceiptRow | null
      return row ? asReceipt(row) : null
    },
    metrics() {
      const receipts = (
        db
          .query(
            `SELECT user_item_id, outcome, model, prompt_tokens, completion_tokens, cost_usd,
                    inference_avoided, inference_attempted, status
             FROM turn_receipts`,
          )
          .all() as ReceiptRow[]
      ).map(asReceipt)
      const attempted = receipts.filter((row) => row.inferenceAttempted)
      const prompt = aggregateField(attempted, (row) => row.promptTokens)
      const completion = aggregateField(attempted, (row) => row.completionTokens)
      const cost = aggregateField(attempted, (row) => row.costUsd)
      return {
        turns: receipts.length,
        hits: receipts.filter((row) => row.outcome === 'hit').length,
        misses: receipts.filter((row) => row.outcome === 'miss').length,
        inferenceAvoided: receipts.filter((row) => row.inferenceAvoided).length,
        inferenceCalls: attempted.length,
        promptTokens: prompt.total,
        completionTokens: completion.total,
        costUsd: cost.total,
        promptTokensKnown: prompt.known,
        promptTokensUnknown: prompt.unknown,
        completionTokensKnown: completion.known,
        completionTokensUnknown: completion.unknown,
        costKnown: cost.known,
        costUnknown: cost.unknown,
      }
    },
    recordAttachment(input) {
      db.run(
        `INSERT OR REPLACE INTO attachments (
          id, owner_agent_id, item_id, path, hash, mime, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.ownerAgentId,
          input.itemId ?? null,
          input.path,
          input.hash,
          input.mime,
          input.kind,
          new Date().toISOString(),
        ],
      )
    },
    bindAttachments(ids, itemId) {
      const bound = itemId.trim()
      if (!bound) return
      for (const id of ids) {
        db.run('UPDATE attachments SET item_id = ? WHERE id = ?', [bound, id])
      }
    },
    attachmentsForItem(itemId) {
      const rows = db
        .query(
          `SELECT id, owner_agent_id, item_id, path, hash, mime, kind
           FROM attachments WHERE item_id = ? ORDER BY created_at ASC`,
        )
        .all(itemId) as {
        id: string
        owner_agent_id: string
        item_id: string | null
        path: string
        hash: string
        mime: string
        kind: string
      }[]
      return rows.map(asAttachment)
    },
    listAttachments(ownerAgentId) {
      const rows = (
        ownerAgentId
          ? (db
              .query(
                `SELECT id, owner_agent_id, item_id, path, hash, mime, kind
                 FROM attachments WHERE owner_agent_id = ? ORDER BY created_at ASC`,
              )
              .all(ownerAgentId) as {
              id: string
              owner_agent_id: string
              item_id: string | null
              path: string
              hash: string
              mime: string
              kind: string
            }[])
          : (db
              .query(
                `SELECT id, owner_agent_id, item_id, path, hash, mime, kind
                 FROM attachments ORDER BY created_at ASC`,
              )
              .all() as {
              id: string
              owner_agent_id: string
              item_id: string | null
              path: string
              hash: string
              mime: string
              kind: string
            }[])
      )
      return rows.map(asAttachment)
    },
  }
}
