import type { AgentId } from '../domain'
import type { Session } from '../session'
import { pendingMouthTurns } from '../session'
import { listOpenRouterKeys, type ResolvedKey } from './keys'
import type { StaffStore, TurnReceipt } from './store'
import { buildWorkingSet, queryFirst, type ChatTurn } from './working-set'

export const DEFAULT_MOUTH_MODEL = 'openai/gpt-4o-mini'

export type MouthHooks = {
  onComplete: (agentId: AgentId, spoken: string) => void
  onFail: (agentId: AgentId, spoken: string) => void
}

export type MouthUsage = {
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
}

export type ChatResult = {
  text: string
  usage?: MouthUsage
}

export type ChatFn = (
  messages: ChatTurn[],
  key: string,
  model: string,
) => Promise<string | ChatResult>

const started = new Set<string>()

export function resetMouthForTests(): void {
  started.clear()
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && /openrouter (401|403)\b/.test(error.message)
}

function unknownUsage(): MouthUsage {
  return { promptTokens: null, completionTokens: null, costUsd: null }
}

export function asChatResult(value: string | ChatResult): { text: string; usage: MouthUsage } {
  if (typeof value === 'string') {
    return { text: value, usage: unknownUsage() }
  }
  return {
    text: value.text,
    usage: {
      promptTokens: value.usage?.promptTokens ?? null,
      completionTokens: value.usage?.completionTokens ?? null,
      costUsd: value.usage?.costUsd ?? null,
    },
  }
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asCost(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Missing provider usage stays null. Never coerce unknown to zero. */
export function parseOpenRouterUsage(body: unknown): MouthUsage {
  const usage =
    body && typeof body === 'object' && 'usage' in body
      ? (body as { usage?: Record<string, unknown> }).usage
      : undefined
  if (!usage || typeof usage !== 'object') return unknownUsage()
  return {
    promptTokens: asCount(usage.prompt_tokens),
    completionTokens: asCount(usage.completion_tokens),
    costUsd: asCost(usage.cost ?? usage.total_cost),
  }
}

function hitReceipt(userItemId: string): TurnReceipt {
  return {
    userItemId,
    outcome: 'hit',
    model: null,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    inferenceAvoided: true,
    inferenceAttempted: false,
    status: 'complete',
  }
}

function missReceipt(
  userItemId: string,
  model: string | null,
  usage: MouthUsage,
  status: TurnReceipt['status'],
  inferenceAttempted: boolean,
): TurnReceipt {
  return {
    userItemId,
    outcome: 'miss',
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
    inferenceAvoided: false,
    inferenceAttempted,
    status,
  }
}

export async function ensureMouth(
  session: Session,
  store: StaffStore,
  hooks: MouthHooks,
  chat: ChatFn = chatOpenRouter,
  keys?: ResolvedKey[],
): Promise<void> {
  for (const turn of pendingMouthTurns(session)) {
    const key = turn.itemId
    if (started.has(key)) continue
    started.add(key)
    let model: string | null = null
    let inferenceAttempted = false
    try {
      const agent = session.agents.find((item) => item.id === turn.agentId)
      if (!agent) {
        store.recordReceipt(missReceipt(turn.itemId, null, unknownUsage(), 'failed', false))
        hooks.onFail(turn.agentId, "Couldn't speak.")
        continue
      }
      const claims = store.recall(turn.userText)
      const recalled = queryFirst(turn.userText, claims)
      if (recalled) {
        store.recordReceipt(hitReceipt(turn.itemId))
        hooks.onComplete(turn.agentId, recalled)
        continue
      }
      const candidates = keys ?? listOpenRouterKeys()
      if (candidates.length === 0) {
        store.recordReceipt(missReceipt(turn.itemId, null, unknownUsage(), 'failed', false))
        hooks.onFail(turn.agentId, 'Need an OpenRouter key.')
        continue
      }
      model = process.env.AUTOMATON_MOUTH_MODEL?.trim() || DEFAULT_MOUTH_MODEL
      const messages = buildWorkingSet({
        agent,
        thread: session.threads[turn.agentId],
        claims,
      })
      let spoken = ''
      let usage = unknownUsage()
      let authRejected = false
      for (const candidate of candidates) {
        try {
          inferenceAttempted = true
          const result = asChatResult(await chat(messages, candidate.key, model))
          spoken = result.text
          usage = result.usage
          authRejected = false
          break
        } catch (error) {
          if (isAuthFailure(error)) {
            authRejected = true
            continue
          }
          throw error
        }
      }
      if (!spoken) {
        store.recordReceipt(missReceipt(turn.itemId, model, unknownUsage(), 'failed', inferenceAttempted))
        hooks.onFail(
          turn.agentId,
          authRejected ? 'OpenRouter key was rejected.' : "Couldn't reach OpenRouter.",
        )
        continue
      }
      store.recordReceipt(missReceipt(turn.itemId, model, usage, 'complete', true))
      hooks.onComplete(turn.agentId, spoken)
    } catch {
      store.recordReceipt(missReceipt(turn.itemId, model, unknownUsage(), 'failed', inferenceAttempted))
      hooks.onFail(turn.agentId, "Couldn't reach OpenRouter.")
    }
  }
}

export async function chatOpenRouter(
  messages: ChatTurn[],
  key: string,
  model: string,
): Promise<ChatResult> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/professorpalmer',
      'X-Title': 'Automaton',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 280,
    }),
  })
  if (!response.ok) {
    throw new Error(`openrouter ${response.status}`)
  }
  const body: unknown = await response.json()
  const text =
    body && typeof body === 'object' && 'choices' in body
      ? ((body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message
          ?.content ?? '')
          .trim()
      : ''
  if (!text) throw new Error('empty mouth')
  return { text, usage: parseOpenRouterUsage(body) }
}
