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

export type JobKind = 'analyze' | 'implement' | 'box-shell'

export type DeskHandoff = {
  agentId: AgentId
  url: string
  instruction: string
}

export type BoxShellIntent =
  | { kind: 'which'; name: string }
  | { kind: 'install'; name: string }

export type AgentKit = 'coordinator' | 'code' | 'lookup' | 'blank'

export type JobHandle = {
  id: string
  ownerAgentId: AgentId
  goal: string
  status: JobStatus
  kind: JobKind
  /** Puppetmaster id. UI must not speak this unless the user asked. */
  pmJobId?: string
  /** Whitelisted keepalive only. Never a sanitized terminal fallback. */
  lastNote?: string
  updatedAt?: number
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

export const MANDATE_MAX_STEPS = 6

/** Original ask while jobs continue. Closed when leftover is not a job, Stop, or the cap. */
export type Mandate = {
  text: string
  steps: number
}

export type Thread = {
  agentId: AgentId
  items: FeedItem[]
  draft: string
  pendingPaths: string[]
  mouth: MouthState
  unread: number
  mandate?: Mandate
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

/** Ephemeral feed wait. Not a persisted item. Jobs use the strip, not this. */
export function feedThinking(mouth: MouthState, items: FeedItem[]): boolean {
  return composerEnterBusy(mouth) && items.length > 0
}

export function thinkingDots(step: number): string {
  return '.'.repeat((Math.abs(Math.trunc(step)) % 4) + 1)
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

/** GitHub hygiene asks. Not a presence ping, and not implement. */
export function looksLikeRepoAsk(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(prs?|pull[- ]requests?)\b/.test(lower) ||
    /\b(open|any|github)\s+issues?\b/.test(lower) ||
    /\bissues?\s+(or|and)\s+(prs?|pull)\b/.test(lower)
  )
}

/** check/list/inspect leftover after addressing is stripped. `check if` is ping, not work. */
export function looksLikeInspect(text: string): boolean {
  const lower = text.toLowerCase().replace(/\bcheck\s+if\b/g, ' ')
  return lower.length > 16 && /\b(check|list|inspect)\b/.test(lower)
}

export function looksLikeExplicitLookup(text: string): boolean {
  const lower = text.toLowerCase()
  return /\b(look up|lookup|research|wiki|search)\b/.test(lower) && lower.length > 16
}

/** Named products on this Mac, not Automaton-as-the-universe. */
const MACHINE_PRODUCT =
  /\b(puppetmaster|marionette|automaton|pm-harness|portable-llm-wiki|portable llm wiki|toyvendor)\b/i

const PRODUCT_CUE =
  /\b(scripts?|files?|modules?|source|excerpts?|routing|router|repo|checkout|codebase|where|how does|what about|stack|dependencies|dependency|frameworks?|manifests?|workspace|made up of|built (?:with|on)|look at)\b/i

const PRODUCT_POSSESSIVE =
  /\b[A-Z][A-Za-z0-9_-]{3,}'s\s+(stack|repo|checkout|codebase|workspace|dependencies|source|files|router|routing|home|manifest)/

export function looksLikeSourceAsk(text: string): boolean {
  const lower = text.toLowerCase()
  if (/\bexcerpts?\b/.test(lower)) return true
  if (/\bshow me\b/.test(lower) && /\b(code|file|script|source|that)\b/.test(lower)) return true
  return /\b(that|the) (file|script|module|code)\b/.test(lower)
}

const FILE_TOKEN = /\b[\w./-]*\w\.(?:md|ts|tsx|js|jsx|py|rs|go|json|toml|yml|yaml|txt|sh|css|html)\b/i

/** A concrete file plus a reveal verb is a look at disk, not a chat answer. */
export function looksLikeFileAsk(text: string): boolean {
  if (!FILE_TOKEN.test(text)) return false
  return /\b(surface|show|read|open|display|print|share|relay|cat|contents?|excerpts?|pull\s+up|what'?s\s+in)\b/i.test(
    text,
  )
}

function namesAProduct(text: string, productNames: string[] = []): boolean {
  if (MACHINE_PRODUCT.test(text) || PRODUCT_POSSESSIVE.test(text)) return true
  return productNames.some((name) => {
    const token = name.trim()
    if (token.length < 3) return false
    return new RegExp(`\\b${escapeRe(token)}\\b`, 'i').test(text)
  })
}

/** Code/docs about a machine checkout. Chat pings stay mouth. */
export function looksLikeCodebaseAsk(
  text: string,
  productNames: string[] = [],
  implicitProduct = false,
): boolean {
  const lower = text.toLowerCase()
  if (lower.length < 16) return false
  if (/\bwhat (scripts?|files?|modules?) does\b/.test(lower)) return true
  const named = namesAProduct(text, productNames)
  const aboutRepo = /\b(?:the|this|its)\s+(?:repo|checkout|codebase|workspace)\b/.test(lower)
  if (named) {
    if (/\b(on-?board(?:ing)?|routing logic|model routing)\b/.test(lower)) return true
    return PRODUCT_CUE.test(lower)
  }
  if (!implicitProduct) return false
  if (aboutRepo && /\b(look|find|inspect|read|show|report)\b/.test(lower)) return true
  return /\b(router|routing logic|stack|dependencies|manifests?)\b/.test(lower)
}

const BOX_SHELL_NAME = /^[A-Za-z][A-Za-z0-9._+-]{0,63}$/

/** PATH/apt on the shared Docker computer. Not a Mac shell and not a chat PTY. */
export function looksLikeBoxShell(text: string): boolean {
  const lower = text.toLowerCase()
  if (/\bapt-get\b|\bapt install\b/.test(lower)) return true
  if (/\b(on(?:\s+the)?\s+path|which\s+|command\s+-v)\b/.test(lower)) return true
  if (/\binstall\b/.test(lower) && /\b(computer|box|linux|the vm)\b/.test(lower)) return true
  return /\binstalled\b/.test(lower) && /\b(computer|box|linux|on path)\b/.test(lower)
}

export function parseBoxShellIntent(text: string): BoxShellIntent | null {
  const which =
    /\b(?:which|command\s+-v)\s+([A-Za-z][A-Za-z0-9._+-]*)/i.exec(text) ??
    /\bis\s+([A-Za-z][A-Za-z0-9._+-]*)\s+(?:on(?:\s+the)?\s+path|installed)\b/i.exec(text)
  const install = /\b(?:apt-get\s+install|apt\s+install|install)\s+([A-Za-z][A-Za-z0-9._+-]*)/i.exec(text)
  const whichName = which?.[1]
  const installName = install?.[1]
  if (/\bon(?:\s+the)?\s+path\b/i.test(text) && whichName && BOX_SHELL_NAME.test(whichName)) {
    return { kind: 'which', name: whichName }
  }
  if (installName && BOX_SHELL_NAME.test(installName) && /\b(computer|box|linux|the vm|apt)\b/i.test(text)) {
    return { kind: 'install', name: installName.toLowerCase() }
  }
  if (whichName && BOX_SHELL_NAME.test(whichName)) return { kind: 'which', name: whichName }
  if (looksLikeBoxShell(text) && installName && BOX_SHELL_NAME.test(installName)) {
    return { kind: 'install', name: installName.toLowerCase() }
  }
  return null
}

export function jobKindLabel(kind: JobKind): string {
  if (kind === 'box-shell') return 'shell'
  return kind
}

export const STILL_RUNNING = 'Still running.'

/** Ask about an in-flight job, not a new booking and not a chat turn. */
export function looksLikeJobStatusAsk(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(how did it go|how'?s it going|how is it going)\b/.test(lower) ||
    /\b(any update|what'?s the status|what is the status|still running)\b/.test(lower) ||
    /\b(did it (?:finish|land|complete|work)|is it (?:done|finished|ready|complete)|what happened)\b/.test(
      lower,
    ) ||
    /\b(what did (?:you|it|we|they) (?:find|do|say)|last (?:job|result))\b/.test(lower)
  )
}

export function isWhitelistedRunningStatus(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === STILL_RUNNING) return true
  return /^Still installing [A-Za-z][A-Za-z0-9._+-]{0,63}\.$/.test(trimmed)
}

/** Nonterminal copy the runtime may emit. Never sanitizeSpeak — that can become Done. */
export function keepAliveStatus(job: Pick<JobHandle, 'kind' | 'goal'>): string {
  if (job.kind === 'box-shell') {
    const intent = parseBoxShellIntent(job.goal)
    if (intent?.kind === 'install') return `Still installing ${intent.name}.`
  }
  return STILL_RUNNING
}

export function runningStatusNote(job: Pick<JobHandle, 'kind' | 'goal' | 'lastNote'>): string {
  if (job.lastNote && isWhitelistedRunningStatus(job.lastNote)) return job.lastNote
  return keepAliveStatus(job)
}

function wantsLook(
  text: string,
  prior = '',
  productNames: string[] = [],
  implicitProduct = false,
): boolean {
  return (
    looksLikeLookup(text) ||
    looksLikeRepoAsk(text) ||
    looksLikeInspect(text) ||
    looksLikeFileAsk(text) ||
    looksLikeCodebaseAsk(text, productNames, implicitProduct) ||
    (looksLikeSourceAsk(text) && looksLikeCodebaseAsk(prior, productNames, implicitProduct))
  )
}

function coordinatorLook(text: string, prior = '', productNames: string[] = []): boolean {
  return (
    looksLikeExplicitLookup(text) ||
    looksLikeCodebaseAsk(text, productNames) ||
    (looksLikeSourceAsk(text) && looksLikeCodebaseAsk(prior, productNames))
  )
}

/** Kit sets default job policy. Blank never dispatches. Coordinator books jobs, not every question. */
export function jobKindForKit(
  kit: AgentKit,
  text: string,
  prior = '',
  productNames: string[] = [],
): JobKind | null {
  if (kit === 'blank') return null
  if (looksLikeBoxShell(text)) return 'box-shell'
  const implicit = kit !== 'coordinator'
  if (kit === 'lookup') {
    return looksLikeJob(text) || wantsLook(text, prior, productNames, implicit) ? 'analyze' : null
  }
  if (looksLikeJob(text)) return 'implement'
  if (kit === 'coordinator') {
    return coordinatorLook(text, prior, productNames) ? 'analyze' : null
  }
  if (wantsLook(text, prior, productNames, implicit)) return 'analyze'
  return null
}

export function foldAsk(text: string): string {
  return text.replace(/^@\S+\s*/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Sequential leftover. Bare `and find` stays one look. */
export function splitAskSteps(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(
    /\s+(?:and\s+)?then\s+|\s+and\s+(?=check|install|which|implement|fix|patch|look)\b|;+\s*/i,
  )
  return parts
    .map((part) => part.replace(/^[,.\s]+|[,\s]+$/g, '').trim())
    .filter((part) => part.length > 0)
}

export function firstAskStep(text: string): string {
  return splitAskSteps(text)[0] ?? text.trim()
}

export function remainingAsk(text: string, completedGoal: string): string {
  const steps = splitAskSteps(text)
  if (steps.length <= 1) return ''
  const done = foldAsk(completedGoal)
  const hit = steps.findIndex((step) => stepMatchesCompleted(step, done))
  if (hit < 0) return steps.slice(1).join(' then ')
  return steps.slice(hit + 1).join(' then ')
}

function stepMatchesCompleted(step: string, done: string): boolean {
  const n = foldAsk(step)
  if (!n || !done) return false
  if (n === done) return true
  if (done.length >= 8 && n.includes(done)) return true
  if (n.length >= 8 && done.includes(n)) return true
  return false
}

export type MandateJob = { kind: JobKind; text: string }

function sameMandateJob(
  kind: JobKind,
  text: string,
  completed: { kind: JobKind; goal: string },
): boolean {
  const n = foldAsk(text)
  const done = foldAsk(completed.goal)
  if (!n || kind !== completed.kind) return false
  if (n === done) return true
  if (done.length >= 8 && done.includes(n)) return true
  if (n.length >= 8 && n.includes(done)) return true
  return false
}

/** Next job from the original ask after a terminal handle. Null means the mandate is done. */
export function nextMandateJob(
  kit: AgentKit,
  mandateText: string,
  completed: { kind: JobKind; goal: string },
  productNames: string[] = [],
  prior = '',
): MandateJob | null {
  const remaining = remainingAsk(mandateText, completed.goal)
  if (remaining) {
    const first = firstAskStep(remaining)
    const kind = jobKindForKit(kit, first, prior || mandateText, productNames)
    if (kind && !sameMandateJob(kind, first, completed)) return { kind, text: first }
    if (kind && sameMandateJob(kind, first, completed)) {
      const rest = remainingAsk(remaining, first)
      if (rest) return nextMandateJob(kit, rest, completed, productNames, prior)
    }
  }
  if (completed.kind !== 'analyze') return null
  if (kit === 'blank' || kit === 'lookup') return null
  if (!looksLikeJob(mandateText)) return null
  const text = remaining || mandateText
  if (sameMandateJob('implement', text, completed)) return null
  return { kind: 'implement', text }
}

/** Seed ids keep the historic policy so existing tests stay pinned. */
export function jobKindFor(agentId: AgentId, text: string, prior = ''): JobKind | null {
  if (agentId === 'staff') return jobKindForKit('coordinator', text, prior)
  if (agentId === 'research') return jobKindForKit('lookup', text, prior)
  if (agentId === 'kernel') return jobKindForKit('code', text, prior)
  return jobKindForKit('blank', text, prior)
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

const AROUND_NOTE = 'The operator asked if you are around.'

const FILLER = new Set([
  'a',
  'also',
  'and',
  'are',
  'can',
  'could',
  'do',
  'does',
  'for',
  'he',
  'here',
  'hey',
  'hi',
  'if',
  'is',
  'it',
  'just',
  'me',
  'now',
  'ok',
  'okay',
  'please',
  'she',
  'still',
  'thanks',
  'the',
  'then',
  'there',
  'they',
  'to',
  'us',
  'we',
  'you',
  'your',
])

const LIVENESS = new Set(['around', 'hello', 'here', 'hi', 'hey', 'online', 'there'])

function stripAddressing(text: string, agents: Agent[]): string {
  let next = ` ${text} `
  next = next.replace(/@\S+/g, ' ')
  const names = agents
    .flatMap((agent) => nameAliases(agent))
    .sort((a, b) => b.length - a.length)
  for (const name of names) {
    next = next.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'), ' ')
  }
  next = next.replace(/\b(can you|could you|would you|will you)\b/gi, ' ')
  next = next.replace(/\b(ask(?:\s+if)?|tell|have|ping|dispatch|see\s+if|check\s+if)\b/gi, ' ')
  next = next.replace(/\b(hey|hi|please|just|also|and)\b/gi, ' ')
  return next.replace(/[,:]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.?!]+|[\s.?!]+$/g, '').trim()
}

function remainderIsWork(text: string): boolean {
  if (looksLikeBoxShell(text) || looksLikeJob(text) || looksLikeRepoAsk(text) || looksLikeInspect(text)) {
    return true
  }
  if (looksLikeCodebaseAsk(text) || looksLikeSourceAsk(text)) return true
  if (looksLikeLookup(text) && !/\b(online|around|there)\b/i.test(text)) return true
  return false
}

function remainderIsLiveness(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((token) => FILLER.has(token) || LIVENESS.has(token))
}

function tidyRemainder(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const capped = trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
  return capped.charAt(0).toUpperCase() + capped.slice(1)
}

export type DispatchWork = { ping: boolean; note: string }

/** Ping is leftover liveness after names and ask/ping/tell/have are stripped. */
export function dispatchWork(text: string, agents: Agent[] = []): DispatchWork {
  const remainder = stripAddressing(text, agents)
  if (remainderIsWork(remainder)) {
    return { ping: false, note: tidyRemainder(remainder) }
  }
  if (remainderIsLiveness(remainder)) {
    return { ping: true, note: AROUND_NOTE }
  }
  if (/\b(online|around|hello|ping)\b/i.test(text) && !remainderIsWork(text)) {
    return { ping: true, note: AROUND_NOTE }
  }
  return { ping: false, note: tidyRemainder(remainder) || text.trim() }
}

export function isPing(text: string, agents: Agent[] = []): boolean {
  return dispatchWork(text, agents).ping
}

const DIRECT_ASK = String.raw`ask(?:\s+if)?|tell|have|ping|dispatch|see\s+if|check(?:\s+if)?`
const NAME_JOIN = /^(and|or|each|both|also|then)$/

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

function rosterNameMap(roster: Agent[]): Map<string, AgentId> {
  const names = new Map<string, AgentId>()
  for (const agent of roster) {
    for (const label of nameAliases(agent)) {
      const key = label.toLowerCase()
      if (!names.has(key)) names.set(key, agent.id)
    }
  }
  return names
}

/** Consecutive roster names after ask/tell/check, joined by and/or/each. Stops at leftover work. */
function namesAfterCue(slice: string, roster: Agent[]): AgentId[] {
  const names = rosterNameMap(roster)
  let maxN = 1
  for (const key of names.keys()) {
    maxN = Math.max(maxN, key.split(/\s+/).filter(Boolean).length)
  }
  const words = slice.toLowerCase().match(/[a-z0-9_-]+/g) ?? []
  const found: AgentId[] = []
  for (let i = 0; i < words.length; ) {
    let hit: { id: AgentId; n: number } | null = null
    for (let n = Math.min(maxN, words.length - i); n >= 1; n -= 1) {
      const gram = words.slice(i, i + n).join(' ')
      const id = names.get(gram)
      if (id) {
        hit = { id, n }
        break
      }
      if (n === 1) {
        const fuzzy = fuzzyRosterId(words[i] ?? '', roster)
        if (fuzzy) {
          hit = { id: fuzzy, n: 1 }
          break
        }
      }
    }
    if (hit) {
      if (!found.includes(hit.id)) found.push(hit.id)
      i += hit.n
      continue
    }
    if (found.length > 0 && NAME_JOIN.test(words[i] ?? '')) {
      i += 1
      continue
    }
    break
  }
  return found
}

export function dispatchTargets(text: string, agents: Agent[], focused?: AgentId): AgentId[] {
  const roster = agents.filter((agent) => !agent.hidden)
  const found = mentionedAgentIds(text, roster)
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(new RegExp(`\\b(?:${DIRECT_ASK})\\b`, 'g'))) {
    const rest = lower.slice((match.index ?? 0) + match[0].length)
    for (const id of namesAfterCue(rest, roster)) {
      if (!found.includes(id)) found.push(id)
    }
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
    /\b(?:name|call)\s+(?:the\s+|this\s+)?(?:new\s+)?(?:automaton|bot|agent|mouth)\s+([A-Za-z][A-Za-z0-9_-]*)/gi,
    /\b(?:name|call)\s+(?:it|him|her)\s+([A-Za-z][A-Za-z0-9_-]*)/gi,
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

/** "the local dugout repo" attaches a machine checkout. Slug is the bare folder name; no clone URL. */
export function parseLocalHomes(text: string): RepoHome[] {
  const found: RepoHome[] = []
  const patterns = [
    /\blocal\s+([A-Za-z0-9_.-]+)\s+repo(?:sitory)?\b/gi,
    /\b([A-Za-z0-9_.-]+)\s+repo(?:sitory)?\s+(?:locally|on\s+(?:this|the)\s+(?:mac|machine))\b/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const slug = match[1]
      if (!slug || NAME_STOP.has(slug.toLowerCase())) continue
      if (!found.some((row) => row.slug.toLowerCase() === slug.toLowerCase())) {
        found.push({ slug, url: '' })
      }
    }
  }
  return found
}

const DESK_URL_SAFE = /^https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/
const DESK_OPEN_VERB = /\b(navigate|browse|visit|go to|pull up|open|pc|computer|chrome|browser|screen|display)\b/i
const DESK_HOST = /(?<!@)\b((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(\/[^\s<>"'`]*)?/i
const NAMED_DESK: Record<string, string> = {
  google: 'www.google.com',
}

export function sanitizeDeskUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,);]+$/g, '')
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const href = url.toString()
    if (href.length > 2000 || !DESK_URL_SAFE.test(href)) return null
    return href
  } catch {
    return null
  }
}

export function parseDeskUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const explicit = /https?:\/\/[^\s<>"'`]+/i.exec(trimmed)
  if (explicit) {
    const url = sanitizeDeskUrl(explicit[0])
    if (!url) return null
    if (parseGithubHomes(trimmed).length > 0 && !/\b(navigate|browse|visit|go to|pull up|open)\b/i.test(trimmed)) {
      return null
    }
    return url
  }
  const githubLogin =
    /\bgithub\.com\/login\b/i.test(trimmed) || (/\bgithub\b/i.test(trimmed) && /\blogin\b/i.test(trimmed))
  if (githubLogin && DESK_OPEN_VERB.test(trimmed)) return 'https://github.com/login'
  if (!DESK_OPEN_VERB.test(trimmed)) return null
  const dotted = DESK_HOST.exec(trimmed)
  if (dotted) return sanitizeDeskUrl(`${dotted[1]}${dotted[2] ?? ''}`)
  for (const [name, host] of Object.entries(NAMED_DESK)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(trimmed)) return sanitizeDeskUrl(host)
  }
  return null
}

export function deskOpenAck(url: string): string {
  let host = url
  try {
    host = new URL(url).host || url
  } catch {
    host = url
  }
  return `Opening ${host}.`
}

export function deskHandoffInstruction(url: string): string {
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return 'Sign in if this page asks.'
  }
  if (host.includes('google')) return 'Sign in to your Google account.'
  if (host.includes('github')) return 'Sign in to GitHub.'
  return `Sign in if ${host} asks.`
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
  const homes = [...parseGithubHomes(text), ...parseLocalHomes(text)]
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
    const repo = home.slug.split('/')[1] ?? home.slug
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
  const verb = isPing(text) || /\b(ask|ping)\b/i.test(text) ? 'Asking' : 'Telling'
  return `${verb} ${names[0] ?? 'them'}.`
}

export function returnBeat(name: string, spoken: string): string {
  const line = sanitizeSpeak(spoken)
  if (/\b(here|around|online|i am here)\b/i.test(line)) return `${name} is on the rail.`
  return `${name} finished.`
}

export function assessAsk(name: string, spoken: string): string {
  return `${name} answered: ${spoken}\nDeliver what that means in your own words. Do not offer a next step for the operator to re-ask. Do not ask permission to continue. Do not repeat ${name}'s sentences.`
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
