import type { ChatPart, ChatTurn } from './working-set'

/** OpenRouter / Anthropic-style ephemeral breakpoint. No TTL clock in the prefix. */
export const CACHE_CONTROL = { type: 'ephemeral' as const }

/** Cheap compact seat. OpenRouter routing; not a Claude compact_* API. */
export const COMPACT_MODEL = 'openai/gpt-4o-mini'

export const COMPACT_CHAR_BUDGET = 24_000

export const COMPACT_KEEP_TAIL = 4

export const SCREENSHOT_PRUNE_EVERY = 25

export const COMPACT_INSTRUCTIONS = [
  'Summarize the dropped middle of this conversation.',
  'Pin exact code, file paths, and decisions.',
  'Keep identifiers, repo paths, and the last user ask.',
  'Do not invent files, commands, or outcomes.',
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

export function shouldCompact(messages: ChatTurn[], budget = COMPACT_CHAR_BUDGET): boolean {
  return workingSetChars(messages) > budget
}

export function shouldPruneScreenshots(turnCount: number, every = SCREENSHOT_PRUNE_EVERY): boolean {
  return every > 0 && turnCount > 0 && turnCount % every === 0
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

function formatMiddle(middle: ChatTurn[]): string {
  return middle
    .map((row) => {
      const body = typeof row.content === 'string' ? row.content : row.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n')
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
  const text = summary.trim()
  if (!text) return messages
  const { prefix, middle, tail } = splitForCompact(messages)
  if (prefix.length === 0 || middle.length === 0) return messages
  return [...prefix, { role: 'user', content: `Compacted history:\n${text}` }, ...tail]
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
