import type { Agent, Thread } from '../domain'
import { imageDataUrl } from './attachments'

export const TAIL = 8

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string | ChatPart[] }

export type ClaimSource = 'job' | 'mouth'

export type ClaimFreshness = 'fresh' | 'stale' | 'unknown'

export type ArtifactKind = 'analyze' | 'implement' | 'mouth'

export type Claim = {
  id: string
  ownerAgentId: string
  text: string
  source: ClaimSource
  jobId?: string
  taskKey?: string
  repo?: string
  revision?: string
  artifactKind?: ArtifactKind
  freshness: ClaimFreshness
}

export type ClaimRef = {
  ownerAgentId: string
  text: string
  taskKey?: string
  repo?: string
  revision?: string
  artifactKind?: ArtifactKind
  freshness?: ClaimFreshness
  jobId?: string
}

const OWNER_TOKENS = new Set(['kernel', 'research', 'staff'])
const STOP_TOKENS = new Set([
  'about',
  'and',
  'are',
  'did',
  'find',
  'finding',
  'findings',
  'finds',
  'for',
  'found',
  'from',
  'had',
  'has',
  'have',
  'how',
  'job',
  'jobs',
  'last',
  'recall',
  'remember',
  'result',
  'results',
  'said',
  'that',
  'the',
  'this',
  'was',
  'were',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with',
  'you',
  'your',
])

const RECALL_REQUEST =
  /\b(what did|what was|finding|you (found|said)|last (job|result)|remember)\b/

const ANALYZE_RECALL = /\b(find|finding|found|analyze|analysed|analyzed|lookup|looked)\b/

const IMPLEMENT_RECALL = /\b(implement|fix|patch)\b/

export function queryTokens(query: string): { owners: string[]; content: string[] } {
  const raw = query.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []
  const owners: string[] = []
  const content: string[] = []
  for (const token of raw) {
    if (OWNER_TOKENS.has(token)) {
      if (!owners.includes(token)) owners.push(token)
      continue
    }
    if (STOP_TOKENS.has(token) || token.length < 3) continue
    if (!content.includes(token)) content.push(token)
  }
  return { owners, content }
}

export function asClaimFreshness(value: unknown): ClaimFreshness {
  if (value === 'fresh' || value === 'stale' || value === 'unknown') return value
  return 'unknown'
}

export function asArtifactKind(value: unknown): ArtifactKind | undefined {
  if (value === 'analyze' || value === 'implement' || value === 'mouth') return value
  return undefined
}

export function normalizeClaimGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function claimTaskKey(input: {
  ownerAgentId: string
  kind: string
  goal: string
}): string {
  return `${input.ownerAgentId}:${input.kind}:${normalizeClaimGoal(input.goal)}`
}

function inferredArtifactKind(query: string): ArtifactKind | null {
  const q = query.toLowerCase()
  if (IMPLEMENT_RECALL.test(q)) return 'implement'
  if (ANALYZE_RECALL.test(q)) return 'analyze'
  return null
}

function inferredTaskKey(query: string): string | null {
  const { owners, content } = queryTokens(query)
  const kind = inferredArtifactKind(query)
  if (owners.length !== 1 || !kind || content.length === 0) return null
  return claimTaskKey({ ownerAgentId: owners[0], kind, goal: content.join(' ') })
}

function uniqueSpeakable(claims: ClaimRef[], content: string[]): string | null {
  const identified =
    content.length === 0
      ? claims
      : claims.filter((claim) => {
          const hay = claim.text.toLowerCase()
          return content.every((token) => hay.includes(token))
        })
  return identified.length === 1 ? identified[0].text : null
}

export function systemPrompt(agent: Agent, rules = ''): string {
  const parts = [
    `You are ${agent.name}, ${agent.title} in Automaton staff.`,
    agent.description,
    'Speak briefly. Do not print job ids. Workers stay mute; you are the mouth.',
    'If recalled claims answer the user, use them. Do not re-derive a stored finding.',
    'Do not ask how you can assist.',
  ]
  const standing = rules.trim()
  if (standing) parts.push(`Standing rules: ${standing}`)
  return parts.join(' ')
}

/** Query-vs-inference: speak only a provenance-safe recall. Never grab an arbitrary recent row. */
export function queryFirst(query: string, claims: ClaimRef[]): string | null {
  if (claims.length === 0) return null
  const q = query.toLowerCase()
  if (!RECALL_REQUEST.test(q)) return null

  const { owners, content } = queryTokens(query)
  if (owners.length === 0 && content.length === 0) return null

  const speakable = claims.filter((claim) => {
    if (owners.length > 0 && !owners.includes(claim.ownerAgentId)) return false
    if (asClaimFreshness(claim.freshness) === 'stale') return false
    if (ANALYZE_RECALL.test(q) && claim.artifactKind === 'implement') return false
    return true
  })
  if (speakable.length === 0) return null

  const derivedKey = inferredTaskKey(query)
  if (derivedKey) {
    const keyed = speakable.filter((claim) => claim.taskKey === derivedKey)
    if (keyed.length === 1) return keyed[0].text
    if (keyed.length > 1) return null
    return uniqueSpeakable(
      speakable.filter((claim) => !claim.taskKey),
      content,
    )
  }

  return uniqueSpeakable(speakable, content)
}

export function buildWorkingSet(input: {
  agent: Agent
  thread: Thread
  claims: ClaimRef[]
  rules?: string
  attachments?: { id: string; path: string; mime: string; kind: 'image' | 'file' }[]
}): ChatTurn[] {
  const messages: ChatTurn[] = [{ role: 'system', content: systemPrompt(input.agent, input.rules) }]
  if (input.claims.length > 0) {
    messages.push({
      role: 'system',
      content: `Recalled claims (sqlite, not transcript):\n${input.claims
        .slice(0, TAIL)
        .map((row) => `- ${row.ownerAgentId}: ${row.text}`)
        .join('\n')}`,
    })
  }
  const attachments = input.attachments ?? []
  const tail = input.thread.items.filter((item) => item.kind === 'msg').slice(-TAIL)
  for (const item of tail) {
    if (item.kind !== 'msg') continue
    const role = item.from === 'user' ? 'user' : 'assistant'
    const bound = attachments.filter((row) => item.attachmentIds?.includes(row.id))
    if (role === 'user' && bound.length > 0) {
      const parts: ChatPart[] = []
      if (item.text.trim()) parts.push({ type: 'text', text: item.text })
      for (const row of bound) {
        if (row.kind === 'image') {
          parts.push({ type: 'image_url', image_url: { url: imageDataUrl(row.path, row.mime) } })
        } else {
          parts.push({ type: 'text', text: `\`${row.path}\`` })
        }
      }
      messages.push({ role, content: parts })
      continue
    }
    messages.push({ role, content: item.text })
  }
  return messages
}
