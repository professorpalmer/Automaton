import type { AgentKit } from '../domain'
import { boxExec } from './box'
import { browse, captureAgentDesk, clickAgentDesk, keyAgentDesk } from './chrome'
import { automatonHome } from './keys'
import { shouldPruneScreenshots, withCacheBreakpoint } from './compact'
import {
  executeComputerBatch,
  stableComputerPrefix,
  trimScreenshots,
  type ComputerToolCall,
  type ComputerToolContext,
  type ComputerToolName,
  type ComputerToolResult,
  type ComputerToolSeams,
} from './computer-tools'
import { OPENROUTER_CHAT_PATH, connectorFetch } from './connector-client'
import { setWorkerDriving } from './driving'
import { displayLeases, type DisplayLeases } from './lease'
import { MOUTH_MAX_TOKENS } from './mouth'
import { mouthModel, mouthModelFor, seatBinding } from './plane'
import { applyProviderReasoningControls } from './provider-maps'

export const COMPUTER_ROUNDS = 24

export type ComputerChatTurn = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  screenshotPath?: string
}

export type ComputerChatFn = (
  messages: ComputerChatTurn[],
) => Promise<{ text: string; actions?: ComputerToolCall[] }>

export type ComputerWorkerHooks = {
  onComplete: (spoken: string, screenshotPath?: string) => void
  onFail: (spoken: string) => void
  onOperatorHelp?: (instruction: string) => void
  onHostApproval?: (prompt: string, action?: string) => void
}

export type ComputerWorkerInput = {
  agentId: string
  agentName: string
  display: number
  goal: string
  kit: AgentKit
  role: 'coordinator' | 'worker'
  holderId?: string
  chat: ComputerChatFn
  seams?: ComputerToolSeams
  maxRounds?: number
}

export type ComputerWorkerOutcome = {
  ok: boolean
  spoken: string
  screenshotPath?: string
  rounds: number
  operatorHelp?: boolean
  needsApproval?: boolean
  action?: string
}

const started = new Set<string>()

export function resetComputerWorkersForTests(): void {
  started.clear()
}

function lastScreenshot(turns: ComputerChatTurn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.screenshotPath) return turns[i].screenshotPath
  }
  return undefined
}

function spokenFromResults(results: ComputerToolResult[], fallback: string): string {
  const last = [...results].reverse().find((row) => row.spoken.trim())
  return last?.spoken ?? fallback
}

export async function runComputerWorker(input: ComputerWorkerInput): Promise<ComputerWorkerOutcome> {
  const holderId = input.holderId ?? `worker:${input.agentId}`
  const maxRounds = input.maxRounds ?? COMPUTER_ROUNDS
  const leases: DisplayLeases = input.seams?.leases ?? displayLeases()
  const ctx: ComputerToolContext = {
    agentId: input.agentId,
    display: input.display,
    holderId,
    role: input.role,
    kit: input.kit,
  }

  if (input.kit === 'blank') {
    return { ok: false, spoken: 'No computer worker until a kit is set.', rounds: 0 }
  }

  const hold = leases.acquire(input.display, holderId)
  if (!hold.ok) {
    return { ok: false, spoken: 'That screen is busy.', rounds: 0 }
  }
  setWorkerDriving(input.display, true)

  const prefix = stableComputerPrefix({
    agentName: input.agentName,
    display: input.display,
  })
  let turns: ComputerChatTurn[] = [
    { role: 'system', content: prefix },
    { role: 'user', content: input.goal },
  ]
  let spoken = ''
  let rounds = 0
  let operatorHelp = false

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      rounds = round + 1
      leases.renew(input.display, holderId)
      if (shouldPruneScreenshots(rounds)) turns = trimScreenshots(turns)
      const reply = await input.chat(turns)
      if (reply.actions && reply.actions.length > 0) {
        const batch = await executeComputerBatch(reply.actions, ctx, input.seams)
        const shot = [...batch.results].reverse().find((row) => row.screenshotPath)?.screenshotPath
        const line = spokenFromResults(batch.results, reply.text)
        turns.push({
          role: 'assistant',
          content: reply.text || line,
          screenshotPath: shot,
        })
        turns.push({
          role: 'tool',
          content: batch.results.map((row) => row.spoken).join('\n'),
          screenshotPath: shot,
        })
        const help = batch.results.find((row) => row.operatorHelp)
        if (help) {
          operatorHelp = true
          spoken = help.spoken
          break
        }
        const approval = batch.results.find((row) => row.needsApproval && !row.refused)
        if (approval) {
          return {
            ok: false,
            spoken: approval.spoken,
            screenshotPath: lastScreenshot(turns),
            rounds,
            needsApproval: true,
            action: approval.action,
          }
        }
        if (batch.halted) {
          spoken = line
          if (batch.results.some((row) => row.refused)) {
            return { ok: false, spoken, screenshotPath: lastScreenshot(turns), rounds, operatorHelp }
          }
          continue
        }
        spoken = line
        continue
      }
      spoken = reply.text.trim()
      if (spoken) break
    }
  } finally {
    setWorkerDriving(input.display, false)
    leases.release(input.display, holderId)
  }

  if (operatorHelp) {
    return { ok: true, spoken, screenshotPath: lastScreenshot(turns), rounds, operatorHelp: true }
  }
  if (!spoken) return { ok: false, spoken: "Didn't land.", screenshotPath: lastScreenshot(turns), rounds }
  return { ok: true, spoken, screenshotPath: lastScreenshot(turns), rounds }
}

export async function ensureComputerWorker(
  id: string,
  input: ComputerWorkerInput,
  hooks: ComputerWorkerHooks,
): Promise<void> {
  if (started.has(id)) return
  started.add(id)
  try {
    const result = await runComputerWorker(input)
    if (result.operatorHelp) {
      hooks.onOperatorHelp?.(result.spoken)
      return
    }
    if (result.needsApproval) {
      hooks.onHostApproval?.(result.spoken, result.action)
      return
    }
    if (result.ok) hooks.onComplete(result.spoken, result.screenshotPath)
    else hooks.onFail(result.spoken)
  } catch {
    hooks.onFail("Didn't land.")
  } finally {
    started.delete(id)
  }
}

export const OPENROUTER_COMPUTER_TOOLS = [
  { type: 'function', function: { name: 'box_shell', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
  { type: 'function', function: { name: 'box_read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'box_screenshot', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'box_browser', parameters: { type: 'object', properties: { url: { type: 'string' } } } } },
  { type: 'function', function: { name: 'box_computer', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, key: { type: 'string' } } } } },
  { type: 'function', function: { name: 'operator_help', parameters: { type: 'object', properties: { instruction: { type: 'string' } } } } },
  { type: 'function', function: { name: 'copy_in', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
  { type: 'function', function: { name: 'copy_out', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
  { type: 'function', function: { name: 'host_read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'host_shell', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
]

function asToolName(name: string): ComputerToolName | null {
  const allowed: ComputerToolName[] = [
    'box_shell',
    'box_read',
    'box_screenshot',
    'box_browser',
    'box_computer',
    'operator_help',
    'copy_in',
    'copy_out',
    'host_read',
    'host_shell',
    'host_attach',
  ]
  return allowed.includes(name as ComputerToolName) ? (name as ComputerToolName) : null
}

export function liveComputerSeams(): ComputerToolSeams {
  return {
    boxExec: (argv, env) => boxExec(argv, env ?? {}),
    browse: (agentId, url) => browse(agentId, url, automatonHome(), { forceBox: true }),
    click: (agentId, point) => clickAgentDesk(agentId, point),
    key: (agentId, stroke) => keyAgentDesk(agentId, stroke),
    screenshot: (agentId) => captureAgentDesk(agentId),
  }
}

export async function chatComputerOpenRouter(
  messages: ComputerChatTurn[],
  key: string,
  model?: string,
  ownerAgentId?: string,
): Promise<{ text: string; actions?: ComputerToolCall[] }> {
  const bound =
    (model && model.trim()) || (ownerAgentId ? mouthModelFor(ownerAgentId) : mouthModel())
  const mapped = messages.map((row) => ({
    role: (row.role === 'tool' ? 'user' : row.role) as 'system' | 'user' | 'assistant',
    content: row.content,
  }))
  const payload = withCacheBreakpoint(mapped)
  const body: Record<string, unknown> = {
    model: bound,
    messages: payload,
    max_tokens: MOUTH_MAX_TOKENS,
    tools: OPENROUTER_COMPUTER_TOOLS,
  }
  if (ownerAgentId) {
    const seat = seatBinding(ownerAgentId)
    applyProviderReasoningControls(body, {
      modelId: bound,
      effort: seat.effort,
      thinking: seat.thinking,
      fast: seat.fast,
      maxMode: seat.effort === 'max' || seat.effort === 'xhigh',
    })
  } else {
    applyProviderReasoningControls(body, { modelId: bound })
  }
  const response = await connectorFetch(
    'openrouter',
    OPENROUTER_CHAT_PATH,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    { bearer: key },
  )
  if (!response.ok) throw new Error(`openrouter ${response.status}`)
  const parsed: unknown = await response.json()
  const message =
    parsed && typeof parsed === 'object' && 'choices' in parsed
      ? (parsed as { choices?: { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] })
          .choices?.[0]?.message
      : undefined
  const text = (message?.content ?? '').trim()
  const actions: ComputerToolCall[] = []
  for (const call of message?.tool_calls ?? []) {
    const name = asToolName(call.function?.name ?? '')
    if (!name) continue
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>
    } catch {
      args = {}
    }
    actions.push({ name, args })
  }
  if (!text && actions.length === 0) throw new Error('empty mouth')
  return { text, actions: actions.length > 0 ? actions : undefined }
}
