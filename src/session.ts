import {
  type Agent,
  type AgentId,
  type DeskHandoff,
  type FeedItem,
  type JobHandle,
  type MouthState,
  type Thread,
  assessAsk,
  bindHomes,
  composerEnterBusy,
  createAgentNames,
  deskHandoffInstruction,
  deskOpenAck,
  dispatchAck,
  dispatchTargets,
  dispatchWork,
  emptyThreads,
  firstAskStep,
  foldAsk,
  homeAck,
  homeNote,
  isWhitelistedRunningStatus,
  jobKindForKit,
  joinAnd,
  keepAliveStatus,
  looksLikeCodebaseAsk,
  looksLikeJobStatusAsk,
  looksLikeSourceAsk,
  MANDATE_MAX_STEPS,
  mentionedAgentIds,
  needsFanoutConfirm,
  nextId,
  nextMandateJob,
  parseDeskUrl,
  remainingAsk,
  renameAck,
  renameAgents,
  returnBeat,
  runningStatusNote,
  sanitizeSpeak,
  visibleAgents,
} from './domain'
import { kitForAgent } from './runtime/profile'

export type Session = {
  agents: Agent[]
  activeAgentId: AgentId
  threads: Record<AgentId, Thread>
  jobs: JobHandle[]
  pendingFanout: { text: string; targets: AgentId[] } | null
  deskOpen?: { agentId: AgentId; url: string } | null
  deskHandoff?: DeskHandoff | null
}

function thread(session: Session, id: AgentId): Thread {
  const found = session.threads[id]
  if (!found) throw new Error(`missing thread ${id}`)
  return found
}

function setThread(session: Session, id: AgentId, patch: Partial<Thread>): Session {
  return {
    ...session,
    threads: { ...session.threads, [id]: { ...thread(session, id), ...patch } },
  }
}

/** Remount cannot finish a live mouth turn. Jobs keep `working`. */
export function idleOrphanMouths(session: Session): Session {
  let next = session
  for (const id of Object.keys(session.threads)) {
    const row = next.threads[id]
    if (!row || row.mouth === 'idle' || row.mouth === 'working') continue
    const last = row.items.at(-1)
    if (row.mouth === 'answer' && last?.kind === 'relay' && last.lane === 'from') {
      const name = next.agents.find((agent) => agent.id === last.peerId)?.name ?? 'They'
      next = wakeMouth(next, id, 'idle')
      next = speak(next, id, returnBeat(name, last.text), next.activeAgentId)
      continue
    }
    next = setThread(next, id, { mouth: 'idle' })
  }
  return next
}

function append(session: Session, agentId: AgentId, item: FeedItem, focused: AgentId): Session {
  const current = thread(session, agentId)
  const unread = agentId === focused ? 0 : current.unread + 1
  return setThread(session, agentId, { items: [...current.items, item], unread })
}

export function setActive(session: Session, agentId: AgentId): Session {
  if (!session.threads[agentId]) return session
  return setThread({ ...session, activeAgentId: agentId }, agentId, { unread: 0 })
}

export function setDraft(session: Session, text: string): Session {
  if (!session.threads[session.activeAgentId]) return session
  return setThread(session, session.activeAgentId, { draft: text })
}

export function queuePaths(session: Session, paths: string[]): Session {
  const active = session.activeAgentId
  if (!session.threads[active]) return session
  const current = thread(session, active).pendingPaths ?? []
  const next = [...current]
  for (const path of paths) {
    if (path && !next.includes(path)) next.push(path)
  }
  return setThread(session, active, { pendingPaths: next })
}

export function dropPendingPath(session: Session, path: string): Session {
  const active = session.activeAgentId
  if (!session.threads[active]) return session
  const current = thread(session, active).pendingPaths ?? []
  return setThread(session, active, { pendingPaths: current.filter((item) => item !== path) })
}

export function clearPendingPaths(session: Session): Session {
  const active = session.activeAgentId
  if (!session.threads[active]) return session
  return setThread(session, active, { pendingPaths: [] })
}

export function dismissFanout(session: Session): Session {
  return { ...session, pendingFanout: null }
}

export function dismissDeskHandoff(session: Session): Session {
  return { ...session, deskHandoff: null }
}

export function confirmDeskHandoff(session: Session): Session {
  return { ...session, deskHandoff: null }
}

export function addLiveAgent(session: Session, agent: Agent, focus = true): Session {
  const agents = session.agents.some((row) => row.id === agent.id)
    ? session.agents.map((row) => (row.id === agent.id ? agent : row))
    : [...session.agents, agent]
  const threads = session.threads[agent.id]
    ? session.threads
    : { ...session.threads, ...emptyThreads([agent]) }
  const steal = focus || !session.activeAgentId || !session.threads[session.activeAgentId]
  return { ...session, agents, threads, activeAgentId: steal ? agent.id : session.activeAgentId }
}

export function dropLiveAgent(session: Session, agentId: AgentId): Session {
  const agents = session.agents.filter((agent) => agent.id !== agentId)
  const threads = { ...session.threads }
  delete threads[agentId]
  const jobs = session.jobs.filter((job) => job.ownerAgentId !== agentId)
  const activeAgentId =
    session.activeAgentId === agentId ? (agents[0]?.id ?? '') : session.activeAgentId
  return { ...session, agents, threads, jobs, activeAgentId }
}

export function patchLiveAgent(session: Session, agent: Agent): Session {
  return {
    ...session,
    agents: session.agents.map((row) => (row.id === agent.id ? agent : row)),
  }
}

export function confirmFanout(session: Session): Session {
  if (!session.pendingFanout) return session
  return send(session, session.pendingFanout.text)
}

function staffParaphrase(text: string): string {
  const trimmed = text.replace(/^@\S+\s*/g, '').trim()
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}

function priorUserText(items: FeedItem[]): string {
  const users = items.filter((item) => item.kind === 'msg' && item.from === 'user')
  if (users.length < 2) return ''
  const prior = users[users.length - 2]
  return prior?.kind === 'msg' ? prior.text : ''
}

function jobGoal(text: string, prior: string, kind: 'analyze' | 'implement' | 'box-shell'): string {
  const goal = staffParaphrase(text)
  if (kind === 'analyze' && looksLikeSourceAsk(text) && looksLikeCodebaseAsk(prior)) {
    return `${goal} (continuing: ${staffParaphrase(prior)})`
  }
  return goal
}

function productNames(session: Session): string[] {
  return visibleAgents(session.agents)
    .filter((row) => row.id !== 'staff')
    .map((row) => row.name)
}

function alreadyRanJob(
  session: Session,
  ownerAgentId: AgentId,
  kind: JobHandle['kind'],
  goal: string,
): boolean {
  const folded = foldAsk(goal)
  return session.jobs.some(
    (row) =>
      row.ownerAgentId === ownerAgentId &&
      row.kind === kind &&
      row.status !== 'running' &&
      foldAsk(row.goal) === folded,
  )
}

function stamped(
  from: 'user' | 'agent',
  agentId: AgentId,
  text: string,
  attachmentIds?: string[],
): FeedItem {
  return {
    kind: 'msg',
    id: nextId('item'),
    from,
    agentId,
    text,
    attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
    at: Date.now(),
  }
}

function speak(session: Session, agentId: AgentId, text: string, focused: AgentId): Session {
  return append(session, agentId, stamped('agent', agentId, text), focused)
}

function wakeMouth(session: Session, agentId: AgentId, mouth: MouthState): Session {
  return setThread(session, agentId, { mouth })
}

/** User send on the focused mouth. Jobs do not lock other mouths. */
export function send(session: Session, raw: string, attachmentIds: string[] = []): Session {
  const text = raw.trim()
  const active = session.activeAgentId
  if (!active || !session.threads[active]) return session
  if (!text && attachmentIds.length === 0) return session
  if (composerEnterBusy(thread(session, active).mouth)) return session

  const roster = visibleAgents(session.agents)
  const kit = kitForAgent(active)
  if (kit === 'coordinator' && session.pendingFanout == null) {
    const created = createAgentNames(text)
    const renamed = renameAgents(text, roster)
    const agents = session.agents.map((agent) => {
      const row = renamed.find((item) => item.agentId === agent.id)
      return row ? { ...agent, name: row.name } : agent
    })
    const homes = bindHomes(text, visibleAgents(agents))
    if (created.length > 0 || homes.length > 0 || renamed.length > 0) {
      return coordinatorSetup({ ...session, agents }, text, created, homes, renamed, roster, attachmentIds)
    }
  }
  const named =
    session.pendingFanout?.targets ??
    (kit === 'coordinator' ? dispatchTargets(text, roster, active) : mentionedAgentIds(text, roster))
  const body = session.pendingFanout?.text ?? text
  if (needsFanoutConfirm(named) && session.pendingFanout == null) {
    return { ...session, pendingFanout: { text, targets: named } }
  }
  const next: Session = { ...session, pendingFanout: null, deskOpen: null, deskHandoff: null }
  if (kit === 'coordinator' && named.length > 0) {
    return coordinatorDispatch(next, body, named, attachmentIds)
  }
  if (named.length > 1) {
    return fanout(next, body, named)
  }
  if (kit === 'coordinator' && named.length === 0) {
    const url = parseDeskUrl(body)
    if (url) return coordinatorDeskOpen(next, body, url, attachmentIds)
  }
  return deliverTo(next, named[0] ?? active, body, active, attachmentIds)
}

function coordinatorDeskOpen(
  session: Session,
  text: string,
  url: string,
  attachmentIds: string[] = [],
): Session {
  const focused = session.activeAgentId
  let next = append(session, focused, stamped('user', focused, text, attachmentIds), focused)
  next = setThread(next, focused, { draft: '', pendingPaths: [], mouth: 'ack' })
  next = speak(next, focused, deskOpenAck(url), focused)
  next = wakeMouth(next, focused, 'idle')
  return {
    ...next,
    deskOpen: { agentId: focused, url },
    deskHandoff: { agentId: focused, url, instruction: deskHandoffInstruction(url) },
  }
}

function coordinatorSetup(
  session: Session,
  text: string,
  names: string[],
  homes: ReturnType<typeof bindHomes>,
  renamed: ReturnType<typeof renameAgents>,
  before: Agent[],
  attachmentIds: string[] = [],
): Session {
  const focused = session.activeAgentId
  const binds = homes.filter((row) => row.agentId !== focused)
  let next = append(session, focused, stamped('user', focused, text, attachmentIds), focused)
  next = setThread(next, focused, { draft: '', pendingPaths: [], mouth: 'ack' })
  const spoken = [
    names.length > 0 ? `Created ${joinAnd(names)}.` : '',
    renameAck(before, renamed),
    homeAck(next.agents, binds),
  ]
    .filter(Boolean)
    .join(' ')
  next = speak(next, focused, spoken || 'Done.', focused)
  for (const bind of binds) {
    const note = homeNote(bind.slug)
    next = appendRelay(next, focused, 'sent', bind.agentId, note, focused)
    next = append(
      next,
      bind.agentId,
      { kind: 'agent_note', id: nextId('item'), fromId: focused, toId: bind.agentId, text: note },
      focused,
    )
    next = deliverTo(next, bind.agentId, note, focused, [], true)
  }
  return wakeMouth(next, focused, 'idle')
}

function appendRelay(
  session: Session,
  threadId: AgentId,
  lane: 'sent' | 'from',
  peerId: AgentId,
  text: string,
  focused: AgentId,
): Session {
  return append(
    session,
    threadId,
    { kind: 'relay', id: nextId('item'), lane, peerId, text },
    focused,
  )
}

function coordinatorDispatch(
  session: Session,
  text: string,
  targets: AgentId[],
  attachmentIds: string[],
): Session {
  const focused = session.activeAgentId
  const work = dispatchWork(text, visibleAgents(session.agents))
  const item = stamped('user', focused, text, attachmentIds)
  let next = append(session, focused, item, focused)
  next = setThread(next, focused, { draft: '', pendingPaths: [], mouth: 'ack' })
  next = speak(next, focused, dispatchAck(text, session.agents, targets, focused), focused)
  const note = work.note
  for (const target of targets) {
    if (target === focused) continue
    next = appendRelay(next, focused, 'sent', target, note, focused)
    next = append(
      next,
      target,
      { kind: 'agent_note', id: nextId('item'), fromId: focused, toId: target, text: note },
      focused,
    )
    next = deliverTo(next, target, note, focused, [], work.ping, text)
  }
  return wakeMouth(next, focused, 'idle')
}

function fanout(session: Session, text: string, targets: AgentId[]): Session {
  const focused = session.activeAgentId
  let next = append(
    session,
    focused,
    stamped('user', focused, text),
    focused,
  )
  next = setThread(next, focused, { draft: '', mouth: 'ack' })
  next = speak(next, focused, 'Telling the others.', focused)
  const note = staffParaphrase(text)
  for (const target of targets) {
    if (target === focused) continue
    next = appendRelay(next, focused, 'sent', target, note, focused)
    next = append(
      next,
      target,
      { kind: 'agent_note', id: nextId('item'), fromId: focused, toId: target, text: note },
      focused,
    )
    next = deliverTo(next, target, note, focused)
  }
  return wakeMouth(next, focused, 'idle')
}

function deliverTo(
  session: Session,
  agentId: AgentId,
  text: string,
  focused: AgentId,
  attachmentIds: string[] = [],
  ping = false,
  mandateText = text,
): Session {
  const item = stamped('user', agentId, text, attachmentIds)
  let next = append(session, agentId, item, focused)
  next = setThread(next, agentId, {
    draft: agentId === focused ? '' : thread(next, agentId).draft,
    pendingPaths: agentId === focused ? [] : thread(next, agentId).pendingPaths,
    mouth: 'must_first',
  })
  const agent = next.agents.find((item) => item.id === agentId)
  const prior = priorUserText(thread(next, agentId).items)
  const products = productNames(next)
  const running = ownerRunningJob(next, agentId)
  if (running && looksLikeJobStatusAsk(text)) {
    next = speak(next, agentId, runningStatusNote(running), focused)
    return wakeMouth(next, agentId, 'working')
  }
  const step = firstAskStep(text)
  const kind = ping ? null : jobKindForKit(kitForAgent(agentId), step, prior, products)
  if (kind) {
    next = speak(next, agentId, ackLine(agent?.name ?? 'Agent'), focused)
    next = wakeMouth(next, agentId, 'ack')
    const handle: JobHandle = {
      id: nextId('job'),
      ownerAgentId: agentId,
      goal: jobGoal(step, prior, kind),
      status: 'running',
      kind,
    }
    next = { ...next, jobs: [...next.jobs, handle] }
    next = setThread(next, agentId, { mandate: { text: mandateText, steps: 1 }, mouth: 'working' })
    return wakeMouth(next, agentId, 'working')
  }
  next = setThread(next, agentId, { mandate: undefined })
  return wakeMouth(next, agentId, 'answer')
}

function ackLine(name: string): string {
  if (name === 'Kernel') return 'On it.'
  if (name === 'Research') return 'Looking.'
  return 'Telling them.'
}

export function pendingMouthTurns(
  session: Session,
): { agentId: AgentId; userText: string; itemId: string; mode: 'chat' | 'assess' }[] {
  const pending: { agentId: AgentId; userText: string; itemId: string; mode: 'chat' | 'assess' }[] = []
  for (const row of Object.values(session.threads)) {
    if (row.mouth !== 'answer') continue
    const last = row.items.at(-1)
    if (last?.kind === 'msg' && last.from === 'user') {
      pending.push({ agentId: row.agentId, userText: last.text, itemId: last.id, mode: 'chat' })
      continue
    }
    if (last?.kind === 'relay' && last.lane === 'from') {
      const name = session.agents.find((agent) => agent.id === last.peerId)?.name ?? 'They'
      pending.push({
        agentId: row.agentId,
        userText: assessAsk(name, last.text),
        itemId: last.id,
        mode: 'assess',
      })
    }
  }
  return pending
}

export function completeMouth(session: Session, agentId: AgentId, spoken: string): Session {
  if (thread(session, agentId).mouth !== 'answer') return session
  const focused = session.activeAgentId
  const from = inboundCoordinatorId(session, agentId)
  let next = speak(session, agentId, sanitizeSpeak(spoken), focused)
  next = wakeMouth(next, agentId, 'idle')
  return coordinatorReturn(next, from, agentId, spoken, focused)
}

function inboundCoordinatorId(session: Session, agentId: AgentId): AgentId | null {
  const row = session.threads[agentId]
  if (!row) return null
  const items = row.items
  let lastUser = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.kind === 'msg' && items[i].from === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 1) return null
  const prior = items[lastUser - 1]
  if (prior?.kind === 'agent_note' && kitForAgent(prior.fromId) === 'coordinator') {
    return prior.fromId
  }
  return null
}

function coordinatorReturn(
  session: Session,
  from: AgentId | null,
  ownerId: AgentId,
  spoken: string,
  focused: AgentId,
): Session {
  if (!from || from === ownerId || !session.threads[from]) return session
  const name = session.agents.find((agent) => agent.id === ownerId)?.name ?? 'They'
  const cleaned = sanitizeSpeak(spoken)
  let next = appendRelay(session, from, 'from', ownerId, cleaned, focused)
  if (thread(next, from).mouth !== 'idle') {
    return speak(next, from, returnBeat(name, cleaned), focused)
  }
  return wakeMouth(next, from, 'answer')
}

export function failMouth(session: Session, agentId: AgentId, spoken: string): Session {
  const row = thread(session, agentId)
  const last = row.items.at(-1)
  if (row.mouth === 'answer' && last?.kind === 'relay' && last.lane === 'from') {
    const name = session.agents.find((agent) => agent.id === last.peerId)?.name ?? 'They'
    let next = wakeMouth(session, agentId, 'idle')
    return speak(next, agentId, returnBeat(name, last.text), session.activeAgentId)
  }
  return completeMouth(session, agentId, spoken)
}

export function attachPmJob(session: Session, jobId: string, pmJobId: string): Session {
  const id = pmJobId.trim()
  if (!id) return session
  return {
    ...session,
    jobs: session.jobs.map((item) => (item.id === jobId ? { ...item, pmJobId: id } : item)),
  }
}

function closeMandateThenReturn(
  session: Session,
  ownerId: AgentId,
  from: AgentId | null,
  spoken: string,
  focused: AgentId,
): Session {
  const next = setThread(session, ownerId, { mandate: undefined, mouth: 'idle' })
  return coordinatorReturn(next, from, ownerId, spoken, focused)
}

function continueMandate(
  session: Session,
  job: JobHandle,
  spoken: string,
  focused: AgentId,
  from: AgentId | null,
  afterFail = false,
): Session {
  const row = thread(session, job.ownerAgentId)
  const mandate = row.mandate
  if (!mandate) return closeMandateThenReturn(session, job.ownerAgentId, from, spoken, focused)
  if (mandate.steps >= MANDATE_MAX_STEPS) {
    return closeMandateThenReturn(session, job.ownerAgentId, from, spoken, focused)
  }
  const prior = priorUserText(row.items)
  const products = productNames(session)
  let nextWork = nextMandateJob(
    kitForAgent(job.ownerAgentId),
    mandate.text,
    job,
    products,
    prior,
  )
  if (afterFail && !remainingAsk(mandate.text, job.goal)) nextWork = null
  if (!nextWork) return closeMandateThenReturn(session, job.ownerAgentId, from, spoken, focused)
  const goal = jobGoal(nextWork.text, prior, nextWork.kind)
  if (alreadyRanJob(session, job.ownerAgentId, nextWork.kind, goal)) {
    return closeMandateThenReturn(session, job.ownerAgentId, from, spoken, focused)
  }
  const handle: JobHandle = {
    id: nextId('job'),
    ownerAgentId: job.ownerAgentId,
    goal,
    status: 'running',
    kind: nextWork.kind,
  }
  let next: Session = { ...session, jobs: [...session.jobs, handle] }
  next = setThread(next, job.ownerAgentId, {
    mandate: { ...mandate, steps: mandate.steps + 1 },
    mouth: 'working',
  })
  return next
}

export function completeJob(session: Session, jobId: string, spoken = 'Done.'): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const focused = session.activeAgentId
  const from = inboundCoordinatorId(session, job.ownerAgentId)
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'complete' as const } : item,
    ),
  }
  next = wakeMouth(next, job.ownerAgentId, 'must_deliver')
  next = speak(next, job.ownerAgentId, sanitizeSpeak(spoken), focused)
  next = wakeMouth(next, job.ownerAgentId, 'idle')
  return continueMandate(next, job, spoken, focused, from)
}

export function failJob(session: Session, jobId: string, spoken = "Didn't land."): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const focused = session.activeAgentId
  const from = inboundCoordinatorId(session, job.ownerAgentId)
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'failed' as const } : item,
    ),
  }
  next = wakeMouth(next, job.ownerAgentId, 'must_deliver')
  next = speak(next, job.ownerAgentId, sanitizeSpeak(spoken), focused)
  next = wakeMouth(next, job.ownerAgentId, 'idle')
  return continueMandate(next, job, spoken, focused, from, true)
}

export function stopJob(session: Session, jobId: string): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'failed' as const } : item,
    ),
  }
  next = setThread(next, job.ownerAgentId, { mandate: undefined, mouth: 'idle' })
  return next
}

export function runningJobs(session: Session): JobHandle[] {
  return session.jobs.filter((job) => job.status === 'running')
}

export function ownerRunningJob(session: Session, agentId: AgentId): JobHandle | undefined {
  const running = session.jobs.filter((job) => job.ownerAgentId === agentId && job.status === 'running')
  return running.at(-1)
}

/** Persist keepalive. First note may speak; later ticks stay off the feed. */
export function noteJobStatus(session: Session, jobId: string, spoken: string): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const note = isWhitelistedRunningStatus(spoken) ? spoken.trim() : keepAliveStatus(job)
  const first = !job.lastNote
  const focused = session.activeAgentId
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, lastNote: note, updatedAt: Date.now() } : item,
    ),
  }
  if (first) {
    next = speak(next, job.ownerAgentId, note, focused)
    next = wakeMouth(next, job.ownerAgentId, 'working')
  }
  return next
}
