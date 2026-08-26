import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { automatonHome } from './keys'
import { peekIdSeq, restoreIdSeq, type AgentId } from '../domain'
import type { Session } from '../session'
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

export type StaffStore = {
  path: string
  save(session: Session): void
  load(): Session | null
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
  `)
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
      db.run(
        'INSERT OR REPLACE INTO snapshot (id, session_json, id_seq) VALUES (1, ?, ?)',
        [JSON.stringify(session), peekIdSeq()],
      )
    },
    load() {
      const row = db.query('SELECT session_json, id_seq FROM snapshot WHERE id = 1').get() as
        | { session_json: string; id_seq: number }
        | null
      if (!row) return null
      restoreIdSeq(row.id_seq)
      return JSON.parse(row.session_json) as Session
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
