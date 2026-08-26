/** Domain types. Mouths speak; Puppetmaster runs jobs. */

import { T } from './tokens'

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

export type AgentKit = 'coordinator' | 'code' | 'lookup' | 'blank'

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
  | {
      kind: 'msg'
      id: string
      from: 'user' | 'agent'
      agentId: AgentId
      text: string
      attachmentIds?: string[]
      at?: number
    }
  | { kind: 'agent_note'; id: string; fromId: AgentId; toId: AgentId; text: string }
  | { kind: 'relay'; id: string; lane: 'sent' | 'from'; peerId: AgentId; text: string }

export type Thread = {
  agentId: AgentId
  items: FeedItem[]
  draft: string
  pendingPaths: string[]
  mouth: MouthState
  unread: number
}

export const STAFF_AGENT: Agent = {
  id: 'staff',
  name: 'Chief of Staff',
  title: 'Coordinator',
  description: 'Owns the computer. Speaks, dispatches, and books jobs.',
  color: T.staff.face,
  hidden: false,
}

/** The only forced mouth. Sisters are created by the user or by Staff. */
export const DEFAULT_AGENTS: Agent[] = [STAFF_AGENT]

/** Named sisters for tests and leftover ids. Not seeded onto a new rail. */
export const SISTER_AGENTS: Agent[] = [
  {
    id: 'kernel',
    name: 'Kernel',
    title: 'Code',
    description: 'Puppetmaster / code. Speaks, then dispatches implement.',
    color: T.kernel.face,
    hidden: false,
  },
  {
    id: 'research',
    name: 'Research',
    title: 'Wiki / web',
    description: 'Looks things up. Speaks, then dispatches analysis.',
    color: T.research.face,
    hidden: false,
  },
]

export function staffWithSisters(): Agent[] {
  return [...DEFAULT_AGENTS, ...SISTER_AGENTS]
}

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

export function looksLikeExplicitLookup(text: string): boolean {
  const lower = text.toLowerCase()
  return /\b(look up|lookup|research|wiki|search)\b/.test(lower) && lower.length > 16
}

/** Kit sets default job policy. Blank never dispatches. Coordinator books jobs, not every question. */
export function jobKindForKit(kit: AgentKit, text: string): JobKind | null {
  if (kit === 'blank') return null
  if (kit === 'lookup') {
    return looksLikeJob(text) || looksLikeLookup(text) ? 'analyze' : null
  }
  if (looksLikeJob(text)) return 'implement'
  if (kit === 'coordinator') {
    return looksLikeExplicitLookup(text) ? 'analyze' : null
  }
  if (looksLikeLookup(text)) return 'analyze'
  return null
}

/** Seed ids keep the historic policy so existing tests stay pinned. */
export function jobKindFor(agentId: AgentId, text: string): JobKind | null {
  if (agentId === 'staff') return jobKindForKit('coordinator', text)
  if (agentId === 'research') return jobKindForKit('lookup', text)
  if (agentId === 'kernel') return jobKindForKit('code', text)
  return jobKindForKit('blank', text)
}

const MENTION = /@([A-Za-z][A-Za-z0-9_-]*)/g

export function mentionedAgentIds(text: string, agents: Agent[]): AgentId[] {
  const names = new Map<string, AgentId>()
  for (const agent of agents) {
    for (const label of nameAliases(agent)) {
      const key = label.toLowerCase()
      if (!names.has(key)) names.set(key, agent.id)
    }
  }
  const found: AgentId[] = []
  for (const match of text.matchAll(MENTION)) {
    const id = names.get(match[1].toLowerCase())
    if (id && !found.includes(id)) found.push(id)
  }
  return found
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nameAliases(agent: Agent): string[] {
  const aliases = [agent.id, agent.name]
  const first = agent.name.trim().split(/\s+/)[0] ?? ''
  if (first && first.toLowerCase() !== agent.id.toLowerCase() && first.toLowerCase() !== agent.name.toLowerCase()) {
    aliases.push(first)
  }
  return aliases.filter((row) => row.trim().length > 0)
}

export function isPing(text: string): boolean {
  const lower = text.toLowerCase()
  if (looksLikeJob(lower)) return false
  if (/\b(look up|lookup|wiki|what is|who is|why did|search)\b/.test(lower)) return false
  return /\b(online|around|there|status|hello|ping)\b/.test(lower)
}

const DIRECT_ASK = String.raw`ask(?:\s+if)?|tell|have|ping|dispatch|see\s+if|check\s+if`

function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return false
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (longer.length - shorter.length > 1) return false
  if (longer.length === shorter.length) {
    let diffs = 0
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) diffs += 1
      if (diffs > 1) return false
    }
    return diffs === 1
  }
  let i = 0
  let j = 0
  let skipped = 0
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1
      j += 1
      continue
    }
    skipped += 1
    j += 1
    if (skipped > 1) return false
  }
  return true
}

function fuzzyRosterId(raw: string, roster: Agent[]): AgentId | null {
  if (raw.length < 8) return null
  let hit: AgentId | null = null
  for (const agent of roster) {
    for (const label of nameAliases(agent)) {
      const key = label.toLowerCase()
      if (key.length < 8 || !isEditDistanceOne(raw, key)) continue
      if (hit && hit !== agent.id) return null
      hit = agent.id
    }
  }
  return hit
}

export function dispatchTargets(text: string, agents: Agent[], focused?: AgentId): AgentId[] {
  const roster = agents.filter((agent) => !agent.hidden)
  const found = mentionedAgentIds(text, roster)
  const lower = text.toLowerCase()
  for (const agent of roster) {
    for (const label of nameAliases(agent)) {
      const token = escapeRe(label.toLowerCase())
      const asked = new RegExp(`\\b(?:${DIRECT_ASK})\\s+${token}\\b`).test(lower)
      if (asked && !found.includes(agent.id)) found.push(agent.id)
    }
  }
  for (const match of lower.matchAll(new RegExp(`\\b(?:${DIRECT_ASK})\\s+([a-z0-9_-]+)`, 'g'))) {
    const raw = match[1]
    if (!raw) continue
    const exact = roster.some((agent) => nameAliases(agent).some((label) => label.toLowerCase() === raw))
    if (exact) continue
    const id = fuzzyRosterId(raw, roster)
    if (id && !found.includes(id)) found.push(id)
  }
  if (focused && found.length === 1 && found[0] === focused && !/@/.test(text)) {
    return []
  }
  return found.filter((id) => id !== focused || found.length > 1)
}

const CREATE_VERB = /\b(create|spin up|make|post|add|stand up)\b/
const CREATE_KIND = /\b(automaton|bot|agent|mouth)\b/
const NAME_STOP = new Set(['the', 'a', 'an', 'this', 'that', 'repo', 'github', 'new', 'http', 'https', 'www'])

function keepCreatedName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return !NAME_STOP.has(trimmed.toLowerCase())
}

export function createAgentNames(text: string): string[] {
  const lower = text.toLowerCase()
  if (!CREATE_VERB.test(lower) || !CREATE_KIND.test(lower)) return []
  const names: string[] = []
  const take = (name: string | undefined) => {
    if (!name || !keepCreatedName(name)) return
    if (names.some((row) => row.toLowerCase() === name.toLowerCase())) return
    names.push(name)
  }
  const patterns = [
    /\b(?:an?\s+)?(?:new\s+)?(?:automaton|bot|agent|mouth)\s+for\s+([A-Za-z][A-Za-z0-9_-]*)/gi,
    /\bone\s+for\s+([A-Za-z][A-Za-z0-9_-]*)/gi,
    /\b(?:an?\s+)?(?:new\s+)?(?:automaton|bot|agent|mouth)\s+(?:named|called)\s+([A-Za-z][A-Za-z0-9_-]*)/gi,
    /\b(?:an?\s+)?(?:new\s+)?(?:automaton|bot|agent|mouth)\s+at\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_-]*)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) take(match[1])
  }
  if (names.length === 0) {
    for (const home of parseGithubHomes(text)) take(home.slug.split('/')[1])
  }
  return names
}

export type AgentRename = { agentId: AgentId; name: string }

export function renameAgents(text: string, agents: Agent[]): AgentRename[] {
  const roster = agents.filter((agent) => !agent.hidden)
  const hay = text.replace(/['"`]/g, ' ').replace(/\s+/g, ' ')
  const out: AgentRename[] = []
  for (const agent of roster) {
    const token = escapeRe(agent.name)
    const match =
      new RegExp(`\\brename\\s+(?:the\\s+)?${token}\\s+to\\s+(.+)$`, 'i').exec(hay) ??
      new RegExp(`\\b(?:call|name)\\s+(?:the\\s+)?${token}\\s+(.+)$`, 'i').exec(hay)
    const name = takeRename(match?.[1] ?? '')
    if (!name || name.toLowerCase() === agent.name.toLowerCase()) continue
    if (out.some((row) => row.agentId === agent.id)) continue
    out.push({ agentId: agent.id, name })
  }
  return out
}

function takeRename(raw: string): string {
  const name = raw
    .trim()
    .replace(/\s+please[.!?]*$/i, '')
    .replace(/[.,!?]+$/g, '')
    .trim()
  if (!/^[A-Za-z]/.test(name)) return ''
  return name.slice(0, 42)
}

export function renameAck(agents: Agent[], rows: AgentRename[]): string {
  if (rows.length === 0) return ''
  const clauses = rows.map((row) => {
    const from = agents.find((agent) => agent.id === row.agentId)?.name ?? row.agentId
    return `${from} is now ${row.name}.`
  })
  return `Renamed. ${clauses.join(' ')}`
}

export type RepoHome = { slug: string; url: string }

export type HomeBind = { agentId: AgentId; slug: string; url: string }

export function parseGithubHomes(text: string): RepoHome[] {
  const found: RepoHome[] = []
  const pattern = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi
  for (const match of text.matchAll(pattern)) {
    const owner = match[1]
    const repo = match[2].replace(/\.git$/i, '')
    const slug = `${owner}/${repo}`
    if (!found.some((row) => row.slug.toLowerCase() === slug.toLowerCase())) {
      found.push({ slug, url: `https://github.com/${slug}` })
    }
  }
  return found
}

function namedInOrder(text: string, agents: Agent[]): Agent[] {
  const hits: { index: number; agent: Agent }[] = []
  for (const agent of agents) {
    const match = new RegExp(`\\b${escapeRe(agent.name)}\\b`, 'i').exec(text)
    if (match && match.index >= 0) hits.push({ index: match.index, agent })
  }
  hits.sort((left, right) => left.index - right.index)
  const seen = new Set<AgentId>()
  const ordered: Agent[] = []
  for (const hit of hits) {
    if (seen.has(hit.agent.id)) continue
    seen.add(hit.agent.id)
    ordered.push(hit.agent)
  }
  return ordered
}

export function bindHomes(text: string, agents: Agent[]): HomeBind[] {
  const homes = parseGithubHomes(text)
  if (homes.length === 0) return []
  const roster = agents.filter((agent) => !agent.hidden)
  const used = new Set<AgentId>()
  const out: HomeBind[] = []
  const take = (agent: Agent | undefined, home: RepoHome) => {
    if (!agent || used.has(agent.id)) return
    used.add(agent.id)
    out.push({ agentId: agent.id, slug: home.slug, url: home.url })
  }
  for (const home of homes) {
    const repo = home.slug.split('/')[1] ?? ''
    take(
      roster.find(
        (agent) =>
          agent.name.toLowerCase() === repo.toLowerCase() || agent.id.toLowerCase() === repo.toLowerCase(),
      ),
      home,
    )
  }
  const leftover = homes.filter((home) => !out.some((row) => row.slug === home.slug))
  const named = namedInOrder(text, roster).filter((agent) => !used.has(agent.id))
  for (let i = 0; i < leftover.length && i < named.length; i += 1) {
    take(named[i], leftover[i])
  }
  return out
}

export function homeAck(agents: Agent[], binds: HomeBind[]): string {
  if (binds.length === 0) return ''
  const clauses = binds.map((bind, index) => {
    const name = agents.find((agent) => agent.id === bind.agentId)?.name ?? bind.agentId
    if (index === 0) return `${name}'s home is ${bind.slug}.`
    return `${name}'s is ${bind.slug}.`
  })
  return `Bound. ${clauses.join(' ')}`
}

export function homeNote(slug: string): string {
  return `Your home is ${slug}. Work for this product goes there, not Automaton.`
}

export function lastSpoken(thread: Thread, fallback = ''): string {
  for (let i = thread.items.length - 1; i >= 0; i -= 1) {
    const item = thread.items[i]
    if (item.kind !== 'msg' || item.from !== 'agent') continue
    const line = item.text.trim().split('\n')[0] ?? ''
    if (!line) continue
    return line.length > 42 ? `${line.slice(0, 39)}...` : line
  }
  return fallback
}

export function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export function dispatchAck(
  text: string,
  agents: Agent[],
  targets: AgentId[],
  focused?: AgentId,
): string {
  const names = targets
    .filter((id) => id !== focused)
    .map((id) => agents.find((agent) => agent.id === id)?.name ?? id)
  if (names.length >= 2) return `Telling ${joinAnd(names)}.`
  const verb = isPing(text) || /\bask\b/i.test(text) ? 'Asking' : 'Telling'
  return `${verb} ${names[0] ?? 'them'}.`
}

export function returnBeat(name: string, spoken: string): string {
  const line = sanitizeSpeak(spoken)
  if (/\b(here|around|online|i am here)\b/i.test(line)) return `${name} is on the rail.`
  return `${name} finished.`
}

export function assessAsk(name: string, spoken: string): string {
  return `${name} answered: ${spoken}\nAssess that for the operator in your own words, then offer one next step they can ask this automaton to run. Do not repeat ${name}'s sentences.`
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
      pendingPaths: [],
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

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function previousPaintedFeedItem(items: FeedItem[], index: number): FeedItem | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const prior = items[cursor]
    if (!prior) continue
    if (prior.kind === 'agent_note') continue
    if (prior.kind === 'relay' && prior.lane === 'from') continue
    return prior
  }
  return null
}

export function sameFeedVoice(prev: FeedItem | null, item: FeedItem, fromPeer: boolean): boolean {
  if (fromPeer || !prev || prev.kind !== 'msg' || item.kind !== 'msg') return false
  return prev.from === item.from
}

export function feedClock(at: number, now = Date.now()): string {
  const then = new Date(at)
  const current = new Date(now)
  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameCalendarDay(then, current)) return `Today ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(current.getDate() - 1)
  if (sameCalendarDay(then, yesterday)) return `Yesterday ${time}`
  return `${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

export function shouldShowFeedClock(prev: FeedItem | null, item: FeedItem): boolean {
  if (item.kind !== 'msg' || item.at == null) return false
  if (!prev || prev.kind !== 'msg' || prev.at == null) return true
  const then = new Date(prev.at)
  const next = new Date(item.at)
  if (!sameCalendarDay(then, next)) return true
  return item.at - prev.at >= T.feed.clockGapMs
}

/** Workers stay mute; mouths never speak a Puppetmaster id unless asked. */
export function sanitizeSpeak(text: string): string {
  const cleaned = text
    .replace(/job_id:\s*\S+/gi, '')
    .replace(/\bjob_[A-Za-z0-9]+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Done.')
}
