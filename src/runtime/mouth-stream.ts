import type { AgentId, FeedItem } from '../domain'
import { nextId } from '../domain'
import type { TurnKickoff } from './auto-approve'

/**
 * Who kicked off the turn that caused a side effect.
 * Maps from TurnKickoff: user → person; intro → unknown.
 * `deployment` is reserved for future deploy wakes (not a kickoff today).
 */
export type InitiatorKind =
  | 'person'
  | 'routine'
  | 'peer-hop'
  | 'channel'
  | 'webhook'
  | 'deployment'
  | 'unknown'

export type ActionDecision = 'permit' | 'refuse'

/** Computer / host / MCP act recorded before the seam runs. Never holds typed text or file bytes. */
export type ActionEvent = {
  id: string
  ownerAgentId: AgentId | string
  tool: string
  intent: string
  decision: ActionDecision
  reason: string
  path?: string
  secretChars?: number
  initiatorKind: InitiatorKind
  at: number
}

/** Mouth-native side-effect stream phases (AG-UI-inspired; no AG-UI SDK). */
export type MouthStreamPhase = 'decide' | 'act' | 'done' | 'refuse'

export type MouthStreamStep = {
  agentId: AgentId | string
  phase: MouthStreamPhase
  tool: string
  intent: string
  /** Path / host / MCP id only — never secrets, stdout, or typed text. */
  detail?: string
}

export const INITIATOR_KINDS: readonly InitiatorKind[] = [
  'person',
  'routine',
  'peer-hop',
  'channel',
  'webhook',
  'deployment',
  'unknown',
] as const

export const MOUTH_STREAM_PHASES: readonly MouthStreamPhase[] = [
  'decide',
  'act',
  'done',
  'refuse',
] as const

export function asInitiatorKind(value: unknown): InitiatorKind | null {
  if (typeof value !== 'string') return null
  return (INITIATOR_KINDS as readonly string[]).includes(value) ? (value as InitiatorKind) : null
}

export function asMouthStreamPhase(value: unknown): MouthStreamPhase | null {
  if (typeof value !== 'string') return null
  return (MOUTH_STREAM_PHASES as readonly string[]).includes(value)
    ? (value as MouthStreamPhase)
    : null
}

/** Map turn kickoff → durable ledger initiator. */
export function initiatorFromKickoff(kickoff: TurnKickoff | undefined | null): InitiatorKind {
  switch (kickoff) {
    case 'user':
      return 'person'
    case 'routine':
      return 'routine'
    case 'peer-hop':
      return 'peer-hop'
    case 'channel':
      return 'channel'
    case 'webhook':
      return 'webhook'
    case 'intro':
    case 'unknown':
    case undefined:
    case null:
      return 'unknown'
    default:
      return 'unknown'
  }
}

export function mouthStreamLabel(
  phase: MouthStreamPhase,
  tool: string,
  intent: string,
  detail?: string,
): string {
  const base = `${phase} · ${tool} · ${intent}`
  const path = detail?.trim()
  return path ? `${base} · ${path}` : base
}

export function mouthStreamFeedItem(
  step: MouthStreamStep,
  at = Date.now(),
): Extract<FeedItem, { kind: 'mouth-stream' }> {
  return {
    kind: 'mouth-stream',
    id: nextId('stream'),
    agentId: step.agentId,
    phase: step.phase,
    tool: step.tool,
    intent: step.intent,
    detail: step.detail?.trim() || undefined,
    at,
  }
}

/** Single gateway builder for action ledger rows (computer / host / MCP). */
export function buildActionEvent(input: {
  id?: string
  ownerAgentId: string
  tool: string
  intent: string
  decision: ActionDecision
  reason: string
  path?: string
  secretChars?: number
  initiatorKind?: InitiatorKind
  at?: number
}): ActionEvent {
  return {
    id: input.id ?? nextId('action'),
    ownerAgentId: input.ownerAgentId,
    tool: input.tool,
    intent: input.intent,
    decision: input.decision,
    reason: input.reason,
    path: input.path?.trim() || undefined,
    secretChars: input.secretChars,
    initiatorKind: input.initiatorKind ?? 'unknown',
    at: input.at ?? Date.now(),
  }
}

export type SideEffectRecordSeams = {
  recordAction?: (event: ActionEvent) => void
  emitMouthStream?: (step: MouthStreamStep) => void
}

/**
 * Record a side-effect decision on the durable ledger and paint mouth-stream
 * phases: decide → (act | refuse). Caller emits `done` after a permitted act.
 */
export function recordSideEffect(
  seams: SideEffectRecordSeams,
  input: {
    ownerAgentId: string
    tool: string
    intent: string
    decision: ActionDecision
    reason: string
    path?: string
    secretChars?: number
    initiatorKind?: InitiatorKind
    at?: number
  },
): ActionEvent {
  const event = buildActionEvent(input)
  const stepBase = {
    agentId: input.ownerAgentId,
    tool: input.tool,
    intent: input.intent,
    detail: input.path,
  }
  seams.emitMouthStream?.({ ...stepBase, phase: 'decide' })
  seams.recordAction?.(event)
  seams.emitMouthStream?.({
    ...stepBase,
    phase: input.decision === 'refuse' ? 'refuse' : 'act',
  })
  return event
}

export function finishSideEffect(
  seams: SideEffectRecordSeams,
  input: { ownerAgentId: string; tool: string; intent: string; path?: string },
): void {
  seams.emitMouthStream?.({
    agentId: input.ownerAgentId,
    phase: 'done',
    tool: input.tool,
    intent: input.intent,
    detail: input.path,
  })
}
