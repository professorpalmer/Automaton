import type { ChatPart, ChatTurn } from './working-set'

/** OpenRouter / Anthropic-style ephemeral breakpoint. No TTL clock in the prefix. */
export const CACHE_CONTROL = { type: 'ephemeral' as const }

/** Cheap compact seat. OpenRouter routing; not a Claude compact_* API. */
export const COMPACT_MODEL = 'openai/gpt-4o-mini'

/** Char trigger for auto-compact on the mouth working set (not Jobs). */
export const COMPACT_CHAR_BUDGET = 24_000

/** Verbatim recent turns kept after a compact splice. */
export const COMPACT_KEEP_TAIL = 4

/** Need at least this many dropped middle turns before a compact pass is worth it. */
export const COMPACT_MIN_MIDDLE = 2

/** After a failed compact, skip auto retries for this window (batch / fail-soft). */
export const COMPACT_FAIL_COOLDOWN_MS = 60_000

export const SCREENSHOT_PRUNE_EVERY = 25

/**
 * Honesty banner for spliced / persisted summaries.
 * Staff must treat this block as summarized, never as verbatim quotes.
 */
export const COMPACT_SUMMARY_PREFIX =
  'Compacted history (summarized — not verbatim quotes):'

export const COMPACT_INSTRUCTIONS = [
  'Summarize the dropped middle of this conversation.',
  'Pin exact code, file paths, and decisions.',
  'Keep identifiers, repo paths, and the last user ask.',
  'Do not invent files, commands, outcomes, or quotes.',
  'The summary is not a transcript — never invent verbatim quotes from compacted turns.',
  'Do not rewrite or repeat the system prompt.',
].join(' ')

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T|\bDate\.now\b|\bunix timestamp\b/i
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

export type CachedTextPart = {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export type OpenRouterTurn = {
  role: string
  content: string | ChatPart[] | CachedTextPart[]
}

export type CompactOutcome =
  | { status: 'skipped'; messages: ChatTurn[] }
  | { status: 'compacted'; messages: ChatTurn[]; summary: string }
  | { status: 'failed'; messages: ChatTurn[]; error: unknown }

let lastFailAt = 0
let lastOkFingerprint = ''

export function resetCompactForTests(): void {
  lastFailAt = 0
  lastOkFingerprint = ''
}

export function turnChars(turn: ChatTurn): number {
  if (typeof turn.content === 'string') return turn.content.length
  let n = 0
  for (const part of turn.content) {
    if (part.type === 'text') n += part.text.length
    else n += part.image_url.url.length
  }
  return n
}

export function workingSetChars(messages: ChatTurn[]): number {
  return messages.reduce((sum, row) => sum + turnChars(row), 0)
}

export function isCompactSummaryTurn(turn: ChatTurn): boolean {
  if (turn.role !== 'user' || typeof turn.content !== 'string') return false
  return (
    turn.content.startsWith(COMPACT_SUMMARY_PREFIX) || turn.content.startsWith('Compacted history:')
  )
}

export function formatCompactSummary(summary: string): string {
  const text = summary.trim()
  if (!text) return ''
  if (text.startsWith(COMPACT_SUMMARY_PREFIX) || text.startsWith('Compacted history:')) return text
  return `${COMPACT_SUMMARY_PREFIX}\n${text}`
}

export function stripCompactPrefix(summary: string): string {
  const text = summary.trim()
  if (text.startsWith(COMPACT_SUMMARY_PREFIX)) {
    return text.slice(COMPACT_SUMMARY_PREFIX.length).trim()
  }
  if (text.startsWith('Compacted history:')) {
    return text.slice('Compacted history:'.length).trim()
  }
  return text
}

export function prefixHasVolatile(text: string): boolean {
  return TIMESTAMP.test(text) || UUID.test(text)
}

export function cachePrefixText(messages: ChatTurn[]): string {
  const first = messages[0]
  if (!first || first.role !== 'system') return ''
  return typeof first.content === 'string' ? first.content : ''
}

function isStableSystem(turn: ChatTurn | undefined): boolean {
  return Boolean(turn && turn.role === 'system' && typeof turn.content === 'string')
}

/** Stable prefix is the first system message. Skill bodies, claims, tools results are tail. */
export function splitPrefixAndTail(messages: ChatTurn[]): { prefix: ChatTurn[]; tail: ChatTurn[] } {
  if (!isStableSystem(messages[0])) return { prefix: [], tail: messages }
  return { prefix: [messages[0]!], tail: messages.slice(1) }
}

export function splitForCompact(messages: ChatTurn[]): {
  prefix: ChatTurn[]
  middle: ChatTurn[]
  tail: ChatTurn[]
} {
  const { prefix, tail: rest } = splitPrefixAndTail(messages)
  if (rest.length <= COMPACT_KEEP_TAIL) return { prefix, middle: [], tail: rest }
  const cut = rest.length - COMPACT_KEEP_TAIL
  return { prefix, middle: rest.slice(0, cut), tail: rest.slice(cut) }
}

export function middleFingerprint(messages: ChatTurn[]): string {
  const { middle } = splitForCompact(messages)
  return `${middle.length}:${workingSetChars(middle)}`
}

/**
 * Auto trigger: over char budget and enough middle turns to drop.
 * Force path bypasses the budget (Compact now) but still needs middle.
 */
export function shouldCompact(
  messages: ChatTurn[],
  budget = COMPACT_CHAR_BUDGET,
  opts?: { force?: boolean },
): boolean {
  const { middle } = splitForCompact(messages)
  if (middle.length < COMPACT_MIN_MIDDLE) return false
  if (opts?.force) return true
  return workingSetChars(messages) > budget
}

export function shouldPruneScreenshots(turnCount: number, every = SCREENSHOT_PRUNE_EVERY): boolean {
  return every > 0 && turnCount > 0 && turnCount % every === 0
}

function formatMiddle(middle: ChatTurn[]): string {
  return middle
    .map((row) => {
      const body =
        typeof row.content === 'string'
          ? row.content
          : row.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n')
      return `${row.role}: ${body}`
    })
    .join('\n\n')
}

export function compactRequestMessages(messages: ChatTurn[]): ChatTurn[] | null {
  const { prefix, middle } = splitForCompact(messages)
  if (prefix.length === 0 || middle.length === 0) return null
  return [
    prefix[0]!,
    { role: 'user', content: `${COMPACT_INSTRUCTIONS}\n\n${formatMiddle(middle)}` },
  ]
}

/** Splice a summary after the cached system prefix. Prefix text stays byte-identical. */
export function applyCompact(messages: ChatTurn[], summary: string): ChatTurn[] {
  const text = stripCompactPrefix(summary)
  if (!text) return messages
  const { prefix, middle, tail } = splitForCompact(messages)
  if (prefix.length === 0 || middle.length === 0) return messages
  return [...prefix, { role: 'user', content: formatCompactSummary(text) }, ...tail]
}

function noteFail(now: number): void {
  lastFailAt = now
}

function noteOk(fingerprint: string): void {
  lastFailAt = 0
  lastOkFingerprint = fingerprint
}

function withinFailCooldown(now: number): boolean {
  return lastFailAt > 0 && now - lastFailAt < COMPACT_FAIL_COOLDOWN_MS
}

export function markCompactFail(now = Date.now()): void {
  noteFail(now)
}

/**
 * Mouth-only compact pass. Jobs / PM artifacts are never in this message list.
 * Fail-soft: returns prior messages on error. Caller records cooldown via
 * markCompactFail so key retries in the same turn can still try.
 */
export async function runCompact(
  messages: ChatTurn[],
  chat: (messages: ChatTurn[], key: string, model: string) => Promise<string | { text: string }>,
  key: string,
  opts?: { force?: boolean; now?: number },
): Promise<CompactOutcome> {
  const now = opts?.now ?? Date.now()
  const force = opts?.force === true
  if (!shouldCompact(messages, COMPACT_CHAR_BUDGET, { force })) {
    return { status: 'skipped', messages }
  }
  if (!force && withinFailCooldown(now)) {
    return { status: 'skipped', messages }
  }
  const fingerprint = middleFingerprint(messages)
  if (!force && fingerprint === lastOkFingerprint) {
    return { status: 'skipped', messages }
  }
  const request = compactRequestMessages(messages)
  if (!request) return { status: 'skipped', messages }
  try {
    const raw = await chat(request, key, COMPACT_MODEL)
    const text = typeof raw === 'string' ? raw : raw.text
    const next = applyCompact(messages, text)
    if (next === messages) return { status: 'skipped', messages }
    noteOk(fingerprint)
    return { status: 'compacted', messages: next, summary: stripCompactPrefix(text) }
  } catch (error) {
    return { status: 'failed', messages, error }
  }
}

export function withCacheBreakpoint(messages: ChatTurn[]): OpenRouterTurn[] {
  return messages.map((row, index) => {
    if (index === 0 && row.role === 'system' && typeof row.content === 'string') {
      return {
        role: 'system',
        content: [{ type: 'text' as const, text: row.content, cache_control: CACHE_CONTROL }],
      }
    }
    return { role: row.role, content: row.content }
  })
}

export function stableToolsJson(tools: unknown): string {
  return JSON.stringify(tools)
}
