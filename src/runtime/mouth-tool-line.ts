import type { Agent, FeedItem, MouthStreamPhase } from '../domain'

/** Whether a later consecutive mouth-stream row supersedes this one in the feed. */
export function mouthStreamSuperseded(
  items: readonly FeedItem[],
  index: number,
): boolean {
  const item = items[index]
  if (!item || item.kind !== 'mouth-stream') return false
  const next = items[index + 1]
  if (!next || next.kind !== 'mouth-stream') return false
  return (
    next.agentId === item.agentId &&
    next.tool === item.tool &&
    next.intent === item.intent
  )
}

export type ToolLineTone = {
  running: boolean
  refused: boolean
  failed: boolean
}

export function mouthStreamTone(phase: MouthStreamPhase): ToolLineTone {
  return {
    running: phase === 'decide' || phase === 'act',
    refused: phase === 'refuse',
    failed: false,
  }
}

/** Human label for a mouth-stream tool row (OpenBot ToolLine rhythm). */
export function mouthStreamToolLabel(tool: string, intent: string): string {
  const t = tool.trim()
  if (t === 'ask_person') return 'Asked you'
  if (t.startsWith('mcp:')) return `MCP ${t.slice(4) || intent}`
  if (t.startsWith('box_')) return intent.trim() || t.replace(/^box_/, '')
  if (t.startsWith('host_')) return intent.trim() || t.replace(/^host_/, '')
  return intent.trim() || t || 'Step'
}

export function hopRelayLabel(
  lane: 'sent' | 'from',
  peerName: string,
  failed?: boolean,
): string {
  if (lane === 'sent') return `Sent to ${peerName}`
  if (failed) return `From ${peerName}`
  return `Message from ${peerName}`
}

export function hopRelayDetail(item: Extract<FeedItem, { kind: 'relay' }>): string | undefined {
  const task = item.task?.trim()
  if (task) return task.length > 72 ? `${task.slice(0, 69)}…` : task
  const text = item.text.trim()
  if (!text) return undefined
  return text.length > 72 ? `${text.slice(0, 69)}…` : text
}

export function hopRelayHasDisclosure(item: Extract<FeedItem, { kind: 'relay' }>): boolean {
  return Boolean(item.task?.trim() || item.expecting?.trim() || item.constraints?.trim() || item.text.trim())
}

export function peerDisplayName(agents: readonly Agent[], peerId: string): string {
  return agents.find((agent) => agent.id === peerId)?.name ?? peerId
}

/**
 * Paint from-relays that carry hop envelope / failure; otherwise the feed still
 * shows Message-from via the agent_note path on the sister reply bubble.
 */
export function shouldPaintHopRelay(item: Extract<FeedItem, { kind: 'relay' }>): boolean {
  if (item.lane === 'sent') return true
  return Boolean(item.task || item.expecting || item.constraints || item.failed)
}
