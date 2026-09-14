/**
 * Wave 7 P1a — interrupt / Stop history hygiene (OpenBot history-sanitize pattern).
 *
 * Person-visible feed rows are never deleted. Provider seed is filtered so a
 * half-finished tool pair cannot poison every later turn.
 */
import type { AgentId, FeedItem } from '../domain'
import { asMouthStreamPhase, type MouthStreamPhase } from './mouth-stream'

/** In-flight mouth-stream phases (ToolLine still running). */
export function isInFlightMouthStreamPhase(phase: MouthStreamPhase): boolean {
  return phase === 'decide' || phase === 'act'
}

export type InFlightMouthStreamArc = {
  tool: string
  intent: string
  detail?: string
  bytes?: number
}

/**
 * Latest mouth-stream arc per tool+intent whose phase is still decide/act.
 * Does not mutate the feed — caller appends a terminal refuse/done row.
 */
export function findInFlightMouthStreamArcs(
  items: readonly FeedItem[],
): InFlightMouthStreamArc[] {
  const latest = new Map<string, { phase: MouthStreamPhase; arc: InFlightMouthStreamArc }>()
  for (const item of items) {
    if (item.kind !== 'mouth-stream') continue
    const phase = asMouthStreamPhase(item.phase)
    if (!phase) continue
    const key = `${item.tool}\u0000${item.intent}`
    latest.set(key, {
      phase,
      arc: {
        tool: item.tool,
        intent: item.intent,
        detail: item.detail,
        bytes: item.bytes,
      },
    })
  }
  const out: InFlightMouthStreamArc[] = []
  for (const row of latest.values()) {
    if (isInFlightMouthStreamPhase(row.phase)) out.push(row.arc)
  }
  return out
}

/** OpenAI / AG-UI-shaped seed message (mouth ChatTurn today has no tool pairs). */
export type ProviderSeedMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer'
  content?: string | null
  /** Assistant tool calls awaiting results. */
  toolCalls?: { id: string }[]
  /** Tool result keyed to a prior call. */
  toolCallId?: string
}

function isSilentSeed(message: ProviderSeedMessage): boolean {
  const content = message.content
  if (content === undefined || content === null) return true
  if (typeof content === 'string') return content.length === 0
  return false
}

/**
 * Drop unanswerable dangling tool calls from provider seed.
 * Does not invent fake successful results. Does not mutate input.
 * Healthy threads (no toolCalls) pass through as the same object references.
 */
export function scrubIncompleteToolPairs(
  history: readonly ProviderSeedMessage[],
  answeredElsewhere: ReadonlySet<string> = new Set(),
): ProviderSeedMessage[] {
  const boundaryAfter: number[] = new Array(history.length).fill(history.length)
  for (let index = history.length - 1, next = history.length; index >= 0; index -= 1) {
    boundaryAfter[index] = next
    if (history[index]?.role === 'user') next = index
  }

  const callAt = new Map<string, number>()
  for (const [index, message] of history.entries()) {
    for (const call of message.toolCalls ?? []) {
      if (!callAt.has(call.id)) callAt.set(call.id, index)
    }
  }

  const answerAt = new Map<string, number>()
  for (const [index, message] of history.entries()) {
    const toolCallId = message.toolCallId
    if (toolCallId === undefined || answerAt.has(toolCallId)) continue
    const called = callAt.get(toolCallId)
    if (called === undefined || index <= called) continue
    if (index >= (boundaryAfter[called] ?? history.length)) continue
    answerAt.set(toolCallId, index)
  }

  const surviving = new Set<string>()
  const kept: (ProviderSeedMessage | undefined)[] = history.map((message) => {
    const toolCalls = message.toolCalls
    if (toolCalls === undefined) return message

    const answered = toolCalls.filter(
      (call) => answeredElsewhere.has(call.id) || answerAt.has(call.id),
    )
    for (const call of answered) surviving.add(call.id)

    if (answered.length === 0 && isSilentSeed(message)) return undefined
    if (answered.length === toolCalls.length) return message
    if (answered.length > 0) {
      return { ...message, toolCalls: answered }
    }
    const { toolCalls: _drop, ...rest } = message
    return rest
  })

  return kept.filter((message): message is ProviderSeedMessage => {
    if (!message) return false
    if (message.role === 'tool' && message.toolCallId) {
      return surviving.has(message.toolCallId)
    }
    return true
  })
}

export const HISTORY_STOP_DETAIL = 'Stopped.'
