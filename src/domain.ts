/** Domain types. Mouths speak; Puppetmaster runs jobs. */

export type MouthState =
  | 'idle'
  | 'must_first'
  | 'answer'
  | 'ack'
  | 'working'
  | 'must_deliver'

export type AgentId = string

export type Agent = {
  id: AgentId
  name: string
  title: string
  description: string
  color: string
  hidden: boolean
}

export type JobStatus = 'running' | 'complete' | 'failed'

export type JobKind = 'analyze' | 'implement'

export type JobHandle = {
  id: string
  ownerAgentId: AgentId
  goal: string
  status: JobStatus
  kind: JobKind
  /** Puppetmaster id. UI must not speak this unless the user asked. */
  pmJobId?: string
}

export type FeedItem =
  | { kind: 'msg'; id: string; from: 'user' | 'agent'; agentId: AgentId; text: string }
  | { kind: 'agent_note'; id: string; fromId: AgentId; toId: AgentId; text: string }

export type Thread = {
  agentId: AgentId
  items: FeedItem[]
  draft: string
  mouth: MouthState
  unread: number
}

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'staff',
    name: 'Staff',
    title: 'Coordinator',
    description: 'Replies, books work, dispatches. Does not do multi-file jobs.',
    color: '#C8C8C8',
    hidden: false,
  },
  {
    id: 'kernel',
    name: 'Kernel',
    title: 'Code',
    description: 'Puppetmaster / code. Speaks, then dispatches implement.',
    color: '#8FBF8F',
    hidden: false,
  },
  {
    id: 'research',
    name: 'Research',
    title: 'Wiki / web',
    description: 'Looks things up. Speaks, then dispatches analysis.',
    color: '#8FA8C8',
    hidden: false,
  },
]

export function visibleAgents(agents: Agent[]): Agent[] {
  return agents.filter((agent) => !agent.hidden)
}

/** Mouth is busy only while this agent is in a pilot turn. A PM job is not busy. */
export function isMouthBusy(mouth: MouthState): boolean {
  return mouth === 'must_first' || mouth === 'answer' || mouth === 'ack' || mouth === 'must_deliver'
}

/** Composer Send stays Send while a job flies. */
export function composerEnterBusy(mouth: MouthState): boolean {
  return mouth === 'must_first' || mouth === 'answer'
}

export function looksLikeJob(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(fix|implement|patch|refactor|build|wire|break(?:s|ing)?)\b/.test(lower) &&
    lower.length > 24
  )
}

export function looksLikeLookup(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(look up|lookup|research|wiki|what is|who is|why did|search)\b/.test(lower) &&
    lower.length > 16
  )
}

/** Staff never jobs. Kernel jobs implement. Research jobs analyze. */
export function jobKindFor(agentId: AgentId, text: string): JobKind | null {
  if (agentId === 'staff') return null
  if (agentId === 'research') {
    return looksLikeJob(text) || looksLikeLookup(text) ? 'analyze' : null
  }
  if (looksLikeJob(text)) return 'implement'
  if (looksLikeLookup(text)) return 'analyze'
  return null
}

const MENTION = /@([A-Za-z][A-Za-z0-9_-]*)/g

export function mentionedAgentIds(text: string, agents: Agent[]): AgentId[] {
  const names = new Map(agents.map((agent) => [agent.name.toLowerCase(), agent.id]))
  const found: AgentId[] = []
  for (const match of text.matchAll(MENTION)) {
    const id = names.get(match[1].toLowerCase())
    if (id && !found.includes(id)) found.push(id)
  }
  return found
}

export function needsFanoutConfirm(mentioned: AgentId[]): boolean {
  return mentioned.length >= 3
}

export function emptyThreads(agents: Agent[]): Record<AgentId, Thread> {
  const threads: Record<AgentId, Thread> = {}
  for (const agent of agents) {
    threads[agent.id] = {
      agentId: agent.id,
      items: [],
      draft: '',
      mouth: 'idle',
      unread: 0,
    }
  }
  return threads
}

let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}_${seq}`
}

export function resetIdsForTests(): void {
  seq = 0
}

export function peekIdSeq(): number {
  return seq
}

export function restoreIdSeq(n: number): void {
  seq = n
}

/** Workers stay mute; mouths never speak a Puppetmaster id unless asked. */
export function sanitizeSpeak(text: string): string {
  const cleaned = text
    .replace(/job_id:\s*\S+/gi, '')
    .replace(/\bjob_[A-Za-z0-9]+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Done.').slice(0, 280)
}
