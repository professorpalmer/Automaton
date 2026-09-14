import type { FeedItem } from '../domain'
import type { ActionEvent } from './mouth-stream'

/**
 * Ephemeral per-sister Activity (Wave 4 P2): commands/files this session,
 * derived from mouth-stream feed rows and/or action ledger events — not a
 * second SQLite table. Paths/sizes only for writes; never file contents or
 * argv/secrets (same honesty as docs/secrets.md + action ledger).
 */

export type SessionActivityKind = 'command' | 'file' | 'browse' | 'other'

export type SessionActivityRow = {
  id: string
  kind: SessionActivityKind
  /** Short paint label — never secrets, stdout, or file bytes. */
  label: string
  tool: string
  intent: string
  path?: string
  /** Write/copy size in bytes when known. */
  bytes?: number
  decision?: 'permit' | 'refuse'
  at: number
}

const WRITE_INTENTS = new Set(['copy_in', 'copy_out', 'write'])
const COMMAND_INTENTS = new Set(['shell', 'host_shell', 'host_attach'])
const BROWSE_INTENTS = new Set(['browse'])
const FILE_INTENTS = new Set(['read', 'host_read', 'copy_in', 'copy_out', 'screenshot', 'write'])

export function formatBytes(n: number): string {
  const size = Math.max(0, Math.floor(n))
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) {
    const kb = size / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mb = size / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function activityKindFor(tool: string, intent: string): SessionActivityKind {
  const i = intent.trim().toLowerCase()
  const t = tool.trim().toLowerCase()
  if (COMMAND_INTENTS.has(i) || t === 'box_shell' || t === 'host_shell') return 'command'
  if (BROWSE_INTENTS.has(i) || t === 'box_browser') return 'browse'
  if (FILE_INTENTS.has(i) || t.startsWith('copy_') || t === 'box_read' || t === 'host_read') return 'file'
  return 'other'
}

export function isWriteActivity(intent: string, tool: string): boolean {
  const i = intent.trim().toLowerCase()
  const t = tool.trim().toLowerCase()
  return WRITE_INTENTS.has(i) || t === 'copy_in' || t === 'copy_out'
}

/** Paint label: writes → path · size only; commands → intent (never argv). */
export function formatActivityLabel(input: {
  kind: SessionActivityKind
  intent: string
  tool: string
  path?: string
  bytes?: number
  decision?: 'permit' | 'refuse'
}): string {
  const intent = input.intent.trim() || input.tool.trim() || 'act'
  const path = input.path?.trim()
  const refused = input.decision === 'refuse' ? 'refuse · ' : ''
  if (isWriteActivity(input.intent, input.tool)) {
    if (path && input.bytes != null && Number.isFinite(input.bytes)) {
      return `${refused}${intent} ${path} · ${formatBytes(input.bytes)}`
    }
    if (path) return `${refused}${intent} ${path}`
    if (input.bytes != null && Number.isFinite(input.bytes)) {
      return `${refused}${intent} · ${formatBytes(input.bytes)}`
    }
    return `${refused}${intent}`
  }
  if (input.kind === 'command') {
    // Never argv / typed text — ledger honesty.
    return `${refused}${intent}`
  }
  if (path) return `${refused}${intent} ${path}`
  return `${refused}${intent}`
}

function parseBytesFromDetail(detail?: string): { path?: string; bytes?: number } {
  const raw = detail?.trim()
  if (!raw) return {}
  const match = raw.match(/^(.*)\s·\s(\d+(?:\.\d+)?)\s*(B|KB|MB)$/i)
  if (!match) return { path: raw }
  const path = match[1]?.trim() || undefined
  const n = Number(match[2])
  const unit = (match[3] ?? 'B').toUpperCase()
  if (!Number.isFinite(n)) return { path: raw }
  const bytes = unit === 'MB' ? Math.round(n * 1024 * 1024) : unit === 'KB' ? Math.round(n * 1024) : Math.floor(n)
  return { path, bytes }
}

export function activityDetail(path?: string, bytes?: number): string | undefined {
  const p = path?.trim()
  if (p && bytes != null && Number.isFinite(bytes)) return `${p} · ${formatBytes(bytes)}`
  if (p) return p
  if (bytes != null && Number.isFinite(bytes)) return formatBytes(bytes)
  return undefined
}

function rowFromParts(input: {
  id: string
  tool: string
  intent: string
  path?: string
  bytes?: number
  decision?: 'permit' | 'refuse'
  at: number
}): SessionActivityRow {
  const kind = activityKindFor(input.tool, input.intent)
  return {
    id: input.id,
    kind,
    label: formatActivityLabel({
      kind,
      intent: input.intent,
      tool: input.tool,
      path: input.path,
      bytes: input.bytes,
      decision: input.decision,
    }),
    tool: input.tool,
    intent: input.intent,
    path: input.path,
    bytes: input.bytes,
    decision: input.decision,
    at: input.at,
  }
}

/**
 * Collapse decide/act/done arcs into one row per tool+path terminal phase.
 * Prefers done/refuse; skips bare decide/act when a terminal follows.
 */
export function sessionActivityFromFeed(items: readonly FeedItem[]): SessionActivityRow[] {
  const pending = new Map<string, SessionActivityRow>()
  const out: SessionActivityRow[] = []
  for (const item of items) {
    if (item.kind !== 'mouth-stream') continue
    const parsed = parseBytesFromDetail(item.detail)
    const path = parsed.path
    const bytes =
      typeof item.bytes === 'number' && Number.isFinite(item.bytes) ? item.bytes : parsed.bytes
    const key = `${item.tool}\0${item.intent}\0${path ?? ''}`
    const decision = item.phase === 'refuse' ? 'refuse' : 'permit'
    const row = rowFromParts({
      id: item.id,
      tool: item.tool,
      intent: item.intent,
      path,
      bytes,
      decision: item.phase === 'refuse' ? 'refuse' : item.phase === 'done' ? 'permit' : decision,
      at: item.at ?? 0,
    })
    if (item.phase === 'decide' || item.phase === 'act') {
      pending.set(key, row)
      continue
    }
    pending.delete(key)
    out.push(row)
  }
  for (const row of pending.values()) out.push(row)
  return out
}

/** Derive Activity from durable ledger rows for this sister (still not a second DB). */
export function sessionActivityFromActions(events: readonly ActionEvent[]): SessionActivityRow[] {
  return events.map((event) =>
    rowFromParts({
      id: event.id,
      tool: event.tool,
      intent: event.intent,
      path: event.path,
      bytes: event.bytes,
      decision: event.decision,
      at: event.at,
    }),
  )
}

/** Prefer feed-derived rows; fall back to ledger when feed is empty. */
export function sessionActivityForSister(input: {
  feed: readonly FeedItem[]
  actions?: readonly ActionEvent[]
}): SessionActivityRow[] {
  const fromFeed = sessionActivityFromFeed(input.feed)
  if (fromFeed.length > 0) return fromFeed
  return sessionActivityFromActions(input.actions ?? [])
}

export function activityHeaderSummary(rows: readonly SessionActivityRow[]): string {
  if (rows.length === 0) return ''
  const counts = new Map<string, number>()
  for (const row of rows) {
    const verb = row.kind === 'command' ? 'shell' : row.kind === 'file' ? (isWriteActivity(row.intent, row.tool) ? 'write' : 'file') : row.kind
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([verb, count]) => (count > 1 ? `${verb} ×${count}` : verb))
    .join(' · ')
}
