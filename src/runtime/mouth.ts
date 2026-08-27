import type { AgentId } from '../domain'
import type { Session } from '../session'
import { pendingMouthTurns } from '../session'
import { OPENROUTER_CHAT_PATH, connectorFetch, type ConnectorFetchSeams } from './connector-client'
import { OPENROUTER_ID } from './connectors'
import { listOpenRouterKeys, type ResolvedKey } from './keys'
import { kitForAgent, readProfile } from './profile'
import { listSkills } from './skills'
import { DEFAULT_SEAT_MODEL, mouthModel } from './plane'
import type { StaffStore, TurnReceipt } from './store'
import { runningTests } from './test-env'
import { buildWorkingSet, introFallback, queryFirst, type ChatTurn } from './working-set'

export const DEFAULT_MOUTH_MODEL = DEFAULT_SEAT_MODEL
export const INTRO_MOUTH_MODEL = 'openai/gpt-4o-mini'
export const MOUTH_MAX_TOKENS = 2048

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

function openRouterStatus(error: unknown): number | null {
  const match = error instanceof Error ? error.message.match(/openrouter (\d{3})\b/) : null
  return match ? Number(match[1]) : null
}

function isAuthFailure(error: unknown): boolean {
  const status = openRouterStatus(error)
  return status === 401 || status === 403
}

function isRateLimited(error: unknown): boolean {
  return openRouterStatus(error) === 429
}

export function mouthFailSpeak(error: unknown, authRejected = false): string {
  if (isRateLimited(error)) return 'OpenRouter rate limited. Try again.'
  if (error instanceof Error && error.message === 'empty mouth') return 'The model returned no text.'
  const status = openRouterStatus(error)
  if (status === 400 || status === 404) return 'OpenRouter rejected this model.'
  if (authRejected) return 'OpenRouter key was rejected.'
  return "Couldn't reach OpenRouter."
}

function retryWaitMs(): number {
  return process.env.NODE_ENV === 'test' ? 0 : 400
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
    if (turn.mode === 'intro') {
      await speakIntro(session, turn.agentId, hooks, chat, keys)
      continue
    }
    let model: string | null = null
    let inferenceAttempted = false
    try {
      const agent = session.agents.find((item) => item.id === turn.agentId)
      if (!agent) {
        store.recordReceipt(missReceipt(turn.itemId, null, unknownUsage(), 'failed', false))
        hooks.onFail(turn.agentId, "Couldn't speak.")
        continue
      }
      const claims = turn.mode === 'assess' ? [] : store.recall(turn.userText)
      const attached = store.attachmentsForItem(turn.itemId)
      const hasVision = attached.some((row) => row.kind === 'image')
      const recalled = turn.mode === 'assess' || hasVision ? null : queryFirst(turn.userText, claims)
      if (recalled) {
        store.recordReceipt(hitReceipt(turn.itemId))
        hooks.onComplete(turn.agentId, recalled)
        continue
      }
      const candidates = keys ?? (runningTests() ? [] : listOpenRouterKeys())
      if (candidates.length === 0) {
        store.recordReceipt(missReceipt(turn.itemId, null, unknownUsage(), 'failed', false))
        hooks.onFail(turn.agentId, 'Need an OpenRouter key.')
        continue
      }
      model = mouthModel()
      const profile = readProfile(turn.agentId)
      const messages = buildWorkingSet({
        agent,
        thread: session.threads[turn.agentId],
        claims,
        rules: profile?.rules,
        kit: kitForAgent(turn.agentId),
        roster: session.agents,
        homeRepo: profile?.homeRepo,
        model,
        attachments: attached,
        skills: listSkills(),
        skillIds: profile?.skillIds ?? [],
        query: turn.userText,
      })
      if (turn.mode === 'assess') {
        messages.push({ role: 'user', content: turn.userText })
      }
      let spoken = ''
      let usage = unknownUsage()
      let authRejected = false
      let lastError: unknown
      for (const candidate of candidates) {
        for (let attempt = 0; attempt < 2 && !spoken; attempt += 1) {
          try {
            inferenceAttempted = true
            const result = asChatResult(await chat(messages, candidate.key, model))
            spoken = result.text
            usage = result.usage
            authRejected = false
            lastError = undefined
          } catch (error) {
            lastError = error
            if (isAuthFailure(error)) {
              authRejected = true
              break
            }
            if (isRateLimited(error) && attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, retryWaitMs()))
              continue
            }
            if (isRateLimited(error)) break
            throw error
          }
        }
        if (spoken) break
      }
      if (!spoken) {
        store.recordReceipt(missReceipt(turn.itemId, model, unknownUsage(), 'failed', inferenceAttempted))
        hooks.onFail(turn.agentId, mouthFailSpeak(lastError, authRejected))
        continue
      }
      store.recordReceipt(missReceipt(turn.itemId, model, usage, 'complete', true))
      hooks.onComplete(turn.agentId, spoken)
    } catch (error) {
      store.recordReceipt(missReceipt(turn.itemId, model, unknownUsage(), 'failed', inferenceAttempted))
      hooks.onFail(turn.agentId, mouthFailSpeak(error))
    }
  }
}

async function speakIntro(
  session: Session,
  agentId: AgentId,
  hooks: MouthHooks,
  chat: ChatFn,
  keys?: ResolvedKey[],
): Promise<void> {
  const agent = session.agents.find((item) => item.id === agentId)
  if (!agent) {
    hooks.onComplete(agentId, '')
    return
  }
  const fallback = introFallback(agent)
  const candidates = keys ?? listOpenRouterKeys()
  if (candidates.length === 0) {
    hooks.onComplete(agentId, fallback)
    return
  }
  const model = INTRO_MOUTH_MODEL
  const profile = readProfile(agentId)
  const messages = buildWorkingSet({
    agent,
    thread: session.threads[agentId],
    claims: [],
    rules: profile?.rules,
    kit: kitForAgent(agentId),
    roster: session.agents,
    homeRepo: profile?.homeRepo,
    model,
    intro: true,
    skills: listSkills(),
    skillIds: profile?.skillIds ?? [],
  })
  let spoken = ''
  for (const candidate of candidates) {
    try {
      const result = asChatResult(await chat(messages, candidate.key, model))
      spoken = result.text.trim()
      if (spoken) break
    } catch {
      continue
    }
  }
  hooks.onComplete(agentId, spoken || fallback)
}

export async function chatOpenRouter(
  messages: ChatTurn[],
  key: string,
  model: string,
  seams?: Pick<ConnectorFetchSeams, 'fetch' | 'home'>,
): Promise<ChatResult> {
  const response = await connectorFetch(
    OPENROUTER_ID,
    OPENROUTER_CHAT_PATH,
    {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MOUTH_MAX_TOKENS,
      }),
    },
    { fetch: seams?.fetch, home: seams?.home, bearer: key },
  )
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
