import { looksLikeLiveCheck, type Agent, type AgentKit, type Thread } from '../domain'
import { imageDataUrl } from './attachments'
import { formatWellKnown, listWellKnownProjects, type MachineProject } from './machine'
import { skillPromptLayers, type SkillMeta } from './skills'

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

function seatFact(model?: string): string {
  if (!model) return ''
  return `This seat runs OpenRouter model ${model}. Answer from that when asked which model we run. Do not tell them to check an API.`
}

function machineFact(projects?: MachineProject[]): string {
  const known = formatWellKnown(projects ?? listWellKnownProjects())
  const places = known
    ? `This Mac: ${known}`
    : 'This Mac keeps git checkouts under ~/Projects.'
  return `${places} Automaton is this staff app, not the default subject. Named products mean those trees. Do not invent Automaton files (plane.json, AUTOMATON_MODEL, seat.py) as if they were Marionette or Puppetmaster. You do not read disk this turn.`
}

export const WIDGET_CUE =
  'To ask a multiple-choice question, reply with a JSON object {"type":"widget","prompt":"...","options":[{"label":"..."}]} (1-6 options). To collect a key, reply with {"type":"secret-request","connectorId":"openrouter"}. Never ask them to paste a key in chat. A widget or secret-request ends the turn.'

export const INTRO_CUE =
  'The user just opened your chat for the first time. Speak one or two sentences. Name yourself. Say what you do from your title and description. Do not ask how you can help. Do not list tools, jobs, or capabilities. Do not say "how can I help you."'

export function introUserCue(agent: Agent): string {
  if (agent.id === 'staff') {
    return `${INTRO_CUE} Mention that you are how they make more automata.`
  }
  return INTRO_CUE
}

export function introFallback(agent: Agent): string {
  const title = agent.title.trim()
  return title ? `${agent.name}. ${title}.` : `${agent.name}.`
}

export function systemPrompt(
  agent: Agent,
  rules = '',
  input?: {
    kit?: AgentKit
    roster?: Agent[]
    homeRepo?: string
    model?: string
    projects?: MachineProject[]
    skills?: SkillMeta[]
    skillIds?: string[]
    query?: string
    intro?: boolean
    mode?: 'chat' | 'assess' | 'intro'
  },
): string {
  const query = input?.query ?? ''
  const productNames = (input?.projects ?? []).map((row) => row.name)
  const liveCheck =
    input?.mode !== 'assess' && input?.intro !== true && looksLikeLiveCheck(query, productNames)
  const recallOk = looksLikeRecallRequest(query) && !liveCheck
  const liveCue =
    'A look is already booked. Do not answer from memory or transcript about GitHub, PRs, or issues.'
  if (input?.kit === 'coordinator') {
    const roster = (input.roster ?? [])
      .filter((row) => !row.hidden)
      .map((row) => `${row.name} (${row.title || row.id})`)
      .join(', ')
    const parts = [
      'You are the head seat. You own this Automaton computer: one local Docker Linux on this Mac. Every automaton shares that machine. An automaton is a cheap screen (X display plus Chrome profile), not another hypervisor. Chrome is lazy and RPC. Disk stays when idle. Never anyrun. You dispatch to roster automata and you may book analyze or implement yourself. Never say you are only a chat seat or that you have no machine. Never tell the operator to ask Kernel for a VM. If they named a sister, the runtime already dispatched; just confirm. If they asked about a product checkout, a look is already booked; do not offer to dispatch and do not ask permission. A GitHub issue or pull URL is work: absorb is already booked. Do not claim you picked it up without a job. Do not merge or tag in chat. Absorb can continue without re-asking. Merge and ship wait on a native widget; do not auto-book them. When a sister answers, say what it means. Do not ask the operator to go ahead on work they already named. Do not parrot their words. You do not pixel-click. Opening a URL is a runtime action. Never claim you navigated Chrome. Never explain displays, Chrome profiles, or how that open works.',
      roster ? `Roster: ${roster}.` : '',
      machineFact(input.projects),
      seatFact(input.model),
      WIDGET_CUE,
      'Speak briefly. Do not print job ids. Do not ask how you can assist.',
      liveCheck ? liveCue : '',
    ].filter(Boolean)
    const standing = rules.trim()
    if (standing) parts.push(`Standing rules: ${standing}`)
    const skills = skillPromptLayers({
      skills: input.skills,
      pinnedIds: input.skillIds,
      query: input.query,
      intro: input.intro,
    })
    if (skills.catalog) parts.push(skills.catalog.replace(/\n/g, ' '))
    return parts.join(' ')
  }
  const parts = [
    `You are ${agent.name}, ${agent.title} in Automaton staff.`,
    agent.description,
    'Speak briefly. Do not print job ids. Workers stay mute; you are the automaton.',
    WIDGET_CUE,
    recallOk
      ? 'If recalled claims answer the user, use them. Do not re-derive a stored finding.'
      : liveCheck
        ? liveCue
        : '',
    'Do not ask how you can assist.',
    machineFact(input?.projects),
    seatFact(input?.model),
  ].filter(Boolean)
  if (input?.homeRepo) {
    parts.push(`Your home is ${input.homeRepo}. Product work goes there, not Automaton. Do not ask for a repo path.`)
  }
  const standing = rules.trim()
  if (standing) parts.push(`Standing rules: ${standing}`)
  const skills = skillPromptLayers({
    skills: input?.skills,
    pinnedIds: input?.skillIds,
    query: input?.query,
    intro: input?.intro,
  })
  if (skills.catalog) parts.push(skills.catalog.replace(/\n/g, ' '))
  return parts.join(' ')
}

export function looksLikeRecallRequest(text: string): boolean {
  return RECALL_REQUEST.test(text.toLowerCase())
}

/** Query-vs-inference: speak only a provenance-safe recall. Never grab an arbitrary recent row. */
export function queryFirst(query: string, claims: ClaimRef[], prior = ''): string | null {
  if (claims.length === 0) return null
  if (looksLikeLiveCheck(query, [], prior)) return null
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
  kit?: AgentKit
  roster?: Agent[]
  homeRepo?: string
  model?: string
  projects?: MachineProject[]
  attachments?: { id: string; path: string; mime: string; kind: 'image' | 'file' }[]
  intro?: boolean
  skills?: SkillMeta[]
  skillIds?: string[]
  query?: string
  mode?: 'chat' | 'assess' | 'intro'
}): ChatTurn[] {
  const layers = skillPromptLayers({
    skills: input.skills,
    pinnedIds: input.skillIds,
    query: input.query,
    intro: input.intro,
  })
  const system = {
    role: 'system' as const,
    content: systemPrompt(input.agent, input.rules, {
      kit: input.kit,
      roster: input.roster,
      homeRepo: input.homeRepo,
      model: input.model,
      projects: input.projects,
      skills: input.skills,
      skillIds: input.skillIds,
      query: input.query,
      intro: input.intro,
      mode: input.mode,
    }),
  }
  if (input.intro) {
    return [system, { role: 'user', content: introUserCue(input.agent) }]
  }
  const messages: ChatTurn[] = [system]
  if (layers.bodies) {
    messages.push({ role: 'system', content: layers.bodies })
  }
  const priorAsk = (() => {
    const users = input.thread.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    if (users.length < 2) return ''
    const prior = users[users.length - 2]
    return prior.kind === 'msg' ? prior.text : ''
  })()
  const liveCheck =
    input.mode !== 'assess' &&
    input.intro !== true &&
    looksLikeLiveCheck(input.query ?? '', [], priorAsk)
  if (input.claims.length > 0 && !liveCheck) {
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
