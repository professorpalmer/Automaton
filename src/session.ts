import {
  type Agent,
  type AgentId,
  type DeskHandoff,
  type FeedItem,
  type GoalBlockerSource,
  type GoalCriterion,
  type GoalCriterionDraft,
  type GoalReceipt,
  type GoalRun,
  type JobHandle,
  type MouthState,
  type Thread,
  assessAsk,
  bindHomes,
  boundGoalEvidence,
  shouldQueueSteer,
  createAgentNames,
  criteriaFromAsk,
  deskHandoffInstruction,
  deskOpenAck,
  dispatchAck,
  dispatchTargets,
  dispatchWork,
  emptyThreads,
  everyCriterionMet,
  firstAskStep,
  goalBlocker,
  goalLaunchContext,
  homeAck,
  homeNote,
  hostApprovalWidget,
  hydrateGoalBlocker,
  isLandKind,
  issueWorkTargets,
  isWhitelistedRunningStatus,
  jobKindForKit,
  joinAnd,
  keepAliveStatus,
  landWidgetForKind,
  looksLikeCodebaseAsk,
  looksLikeJobStatusAsk,
  looksLikeSourceAsk,
  mentionedAgentIds,
  needsFanoutConfirm,
  nextId,
  nextUnmetCriterion,
  normalizeWidget,
  parseDeskUrl,
  parseGithubIssue,
  parseMouthEmit,
  renameAck,
  renameAgents,
  returnBeat,
  runningStatusNote,
  sanitizeSpeak,
  sessionGoals,
  type QuestionWidget,
  type WidgetAnswer,
  type WidgetPurpose,
  visibleAgents,
  widgetDismissOnMoveOn,
  widgetReplyText,
} from './domain'
import { kitForAgent } from './runtime/profile'
import { displayForMouth } from './runtime/computer'
import {
  computerWorkerAllowed,
  HOST_APPROVAL_PROMPT,
  looksLikeComputerUse,
  needsOperatorHandoff,
} from './runtime/computer-tools'
import { knownConnectorId, writeConnectorSecret } from './runtime/connectors'

export type ComputerWorkerStatus = 'running' | 'complete' | 'failed' | 'waiting_operator'

export type ComputerWorker = {
  id: string
  ownerAgentId: AgentId
  display: number
  goal: string
  status: ComputerWorkerStatus
  instruction?: string
  screenshotPath?: string
  /** Set after the host widget. Host tools still never run silent. */
  hostAllowed?: boolean
}

export type Session = {
  agents: Agent[]
  activeAgentId: AgentId
  threads: Record<AgentId, Thread>
  jobs: JobHandle[]
  goals?: GoalRun[]
  pendingFanout: { text: string; targets: AgentId[] } | null
  deskOpen?: { agentId: AgentId; url: string } | null
  deskHandoff?: DeskHandoff | null
  computerWorkers?: ComputerWorker[]
}

/** Old snapshots omit goals and may still carry a worker mandate. */
export function normalizeSession(session: Session): Session {
  const threads: Record<AgentId, Thread> = {}
  for (const [id, row] of Object.entries(session.threads ?? {})) {
    if (!row) continue
    const leftover = { ...row } as Thread & { mandate?: unknown }
    delete leftover.mandate
    leftover.steerQueue = Array.isArray(leftover.steerQueue) ? leftover.steerQueue : []
    leftover.jobSteerQueue = Array.isArray(leftover.jobSteerQueue) ? leftover.jobSteerQueue : []
    threads[id] = leftover
  }
  return {
    ...session,
    threads,
    jobs: Array.isArray(session.jobs) ? session.jobs : [],
    computerWorkers: Array.isArray(session.computerWorkers) ? session.computerWorkers : [],
    goals: sessionGoals(session.goals).map((goal) => {
      const blocker = hydrateGoalBlocker(goal.blocker)
      return blocker ? { ...goal, blocker } : goal
    }),
  }
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
      next = finishBatch(next, id)
      continue
    }
    next = setThread(next, id, { mouth: 'idle' })
    next = finishBatch(next, id)
  }
  next = {
    ...next,
    computerWorkers: (next.computerWorkers ?? []).map((row) =>
      row.status === 'running' || row.status === 'waiting_operator'
        ? { ...row, status: 'failed' as const }
        : row,
    ),
  }
  for (const id of Object.keys(next.threads)) {
    if (next.threads[id]?.computerBusy) next = setThread(next, id, { computerBusy: false })
  }
  return next
}

function append(session: Session, agentId: AgentId, item: FeedItem, focused: AgentId): Session {
  const current = thread(session, agentId)
  const unread = agentId === focused ? 0 : current.unread + 1
  return setThread(session, agentId, { items: [...current.items, item], unread })
}

export function setActive(session: Session, agentId: AgentId, introPlayedAt?: string | null): Session {
  if (!session.threads[agentId]) return session
  const next = setThread({ ...session, activeAgentId: agentId }, agentId, { unread: 0 })
  if (introPlayedAt === undefined) return next
  return maybeIntro(next, agentId, introPlayedAt)
}

export function setDraft(session: Session, text: string): Session {
  if (!session.threads[session.activeAgentId]) return session
  return setThread(session, session.activeAgentId, { draft: text })
}

function enqueueSteer(session: Session, text: string, attachmentIds: string[] = []): Session {
  const active = session.activeAgentId
  if (!session.threads[active]) return session
  if (!text && attachmentIds.length === 0) return session
  const current = thread(session, active).steerQueue ?? []
  return setThread(session, active, {
    draft: '',
    pendingPaths: [],
    steerQueue: [
      ...current,
      {
        text,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      },
    ],
  })
}

function takeSteer(session: Session, agentId: AgentId): { session: Session; text: string; attachmentIds: string[] } | null {
  const row = session.threads[agentId]
  if (!row) return null
  const queued = row.steerQueue ?? []
  if (queued.length === 0) return null
  const text = queued.map((line) => line.text).filter(Boolean).join('\n')
  const attachmentIds = queued.flatMap((line) => line.attachmentIds ?? [])
  const next = setThread(session, agentId, { steerQueue: [] })
  if (!text && attachmentIds.length === 0) return { session: next, text: '', attachmentIds: [] }
  return { session: next, text, attachmentIds }
}

/** Inject parked user words as the next turn once the mouth/tool batch is idle. Empty is a no-op. */
export function drainSteer(session: Session, agentId: AgentId): Session {
  const row = session.threads[agentId]
  if (!row) return session
  if (shouldQueueSteer(row.mouth, row.computerBusy === true)) return session
  if (row.mouth !== 'idle') return session
  const taken = takeSteer(session, agentId)
  if (!taken) return session
  if (!taken.text && taken.attachmentIds.length === 0) return taken.session
  const focused = taken.session.activeAgentId
  let next = taken.session.activeAgentId === agentId ? taken.session : { ...taken.session, activeAgentId: agentId }
  next = send(next, taken.text, taken.attachmentIds)
  if (focused !== agentId && next.threads[focused]) next = { ...next, activeAgentId: focused }
  return next
}

function dropJobSteer(session: Session, agentId: AgentId): Session {
  if (!session.threads[agentId]) return session
  return setThread(session, agentId, { jobSteerQueue: [] })
}

function finishBatch(session: Session, agentId: AgentId): Session {
  return drainSteer(session, agentId)
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

export function addLiveAgent(
  session: Session,
  agent: Agent,
  focus = true,
  introPlayedAt?: string | null,
): Session {
  const agents = session.agents.some((row) => row.id === agent.id)
    ? session.agents.map((row) => (row.id === agent.id ? agent : row))
    : [...session.agents, agent]
  const threads = session.threads[agent.id]
    ? session.threads
    : { ...session.threads, ...emptyThreads([agent]) }
  const steal = focus || !session.activeAgentId || !session.threads[session.activeAgentId]
  const next = { ...session, agents, threads, activeAgentId: steal ? agent.id : session.activeAgentId }
  if (!steal || introPlayedAt === undefined) return next
  return maybeIntro(next, agent.id, introPlayedAt)
}

export function dropLiveAgent(session: Session, agentId: AgentId): Session {
  const agents = session.agents.filter((agent) => agent.id !== agentId)
  const threads = { ...session.threads }
  delete threads[agentId]
  const jobs = session.jobs.filter((job) => job.ownerAgentId !== agentId)
  const goals = sessionGoals(session.goals).filter((goal) => goal.ownerAgentId !== agentId)
  const computerWorkers = (session.computerWorkers ?? []).filter((row) => row.ownerAgentId !== agentId)
  const activeAgentId =
    session.activeAgentId === agentId ? (agents[0]?.id ?? '') : session.activeAgentId
  return { ...session, agents, threads, jobs, goals, computerWorkers, activeAgentId }
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

function jobGoal(
  text: string,
  prior: string,
  kind: JobHandle['kind'],
): string {
  if (kind === 'promote' || kind === 'ship' || parseGithubIssue(text)) return text.trim()
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
  const row = thread(session, active)
  if (shouldQueueSteer(row.mouth, row.computerBusy === true)) {
    return enqueueSteer(session, text, attachmentIds)
  }
  session = dismissMoveOnWidgets(session, active)

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
    const issueWork = parseGithubIssue(text) != null
    if (created.length > 0 || renamed.length > 0 || (homes.length > 0 && !issueWork)) {
      return coordinatorSetup({ ...session, agents }, text, created, homes, renamed, roster, attachmentIds)
    }
    if (homes.length > 0 && issueWork) {
      return coordinatorSetup(
        { ...session, agents },
        text,
        created,
        homes,
        renamed,
        roster,
        attachmentIds,
        true,
      )
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
  if (needsOperatorHandoff(url, text)) {
    next = wakeMouth(next, focused, 'idle')
    return {
      ...next,
      deskOpen: { agentId: focused, url },
      deskHandoff: { agentId: focused, url, instruction: deskHandoffInstruction(url) },
    }
  }
  next = { ...next, deskOpen: null, deskHandoff: null }
  return bookComputer(next, focused, text)
}

function coordinatorSetup(
  session: Session,
  text: string,
  names: string[],
  homes: ReturnType<typeof bindHomes>,
  renamed: ReturnType<typeof renameAgents>,
  before: Agent[],
  attachmentIds: string[] = [],
  continueWork = false,
): Session {
  const focused = session.activeAgentId
  const binds = homes.filter((row) => row.agentId !== focused)
  const roster = visibleAgents(session.agents)
  const targets = continueWork ? issueWorkTargets(text, roster, focused) : []
  if (continueWork && targets.length === 0) {
    return deliverTo(session, focused, text, focused, attachmentIds, false, text)
  }
  let next = append(session, focused, stamped('user', focused, text, attachmentIds), focused)
  next = setThread(next, focused, { draft: '', pendingPaths: [], mouth: 'ack' })
  const spoken = [
    names.length > 0 ? `Created ${joinAnd(names)}.` : '',
    renameAck(before, renamed),
    homeAck(next.agents, binds),
    continueWork && targets.length > 0 ? dispatchAck(text, next.agents, targets, focused) : '',
  ]
    .filter(Boolean)
    .join(' ')
  next = speak(next, focused, spoken || 'Done.', focused)
  if (continueWork) {
    for (const target of targets) {
      if (target === focused) continue
      next = appendRelay(next, focused, 'sent', target, text, focused)
      next = append(
        next,
        target,
        { kind: 'agent_note', id: nextId('item'), fromId: focused, toId: target, text: text },
        focused,
      )
      next = deliverTo(next, target, text, focused, [], false, text)
    }
    return wakeMouth(next, focused, 'idle')
  }
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
  const kit = kitForAgent(agentId)
  const source = parseGithubIssue(mandateText) ? mandateText : text
  const drafts = ping ? [] : criteriaFromAsk(source, kit, prior, products)
  const step = drafts[0]?.work ?? firstAskStep(text)
  const kind = ping ? null : (drafts[0]?.kind ?? jobKindForKit(kit, step, prior, products))
  if (kind) {
    next = speak(next, agentId, ackLine(agent?.name ?? 'Agent'), focused)
    next = wakeMouth(next, agentId, 'ack')
    const rows = drafts.length > 0 ? drafts : [{ label: kind, kind, work: step }]
    return openGoalRun(next, agentId, focused, mandateText, rows, prior)
  }
  if (computerWorkerAllowed(kit, ping) && looksLikeComputerUse(text)) {
    const url = parseDeskUrl(text)
    next = speak(next, agentId, url ? deskOpenAck(url) : 'On it.', focused)
    return bookComputer(next, agentId, text)
  }
  return wakeMouth(next, agentId, 'answer')
}

function putGoal(session: Session, goal: GoalRun): Session {
  const goals = sessionGoals(session.goals)
  const hit = goals.findIndex((row) => row.id === goal.id)
  if (hit < 0) return { ...session, goals: [...goals, goal] }
  return { ...session, goals: goals.map((row) => (row.id === goal.id ? goal : row)) }
}

function openGoalRun(
  session: Session,
  ownerAgentId: AgentId,
  focused: AgentId,
  objective: string,
  drafts: GoalCriterionDraft[],
  prior: string,
): Session {
  const firstDraft = drafts[0]
  const widgetFirst = firstDraft ? isLandKind(firstDraft.kind) : false
  const criteria: GoalCriterion[] = drafts.map((row, index) => ({
    ...row,
    id: nextId('crit'),
    status: !widgetFirst && index === 0 ? 'running' : 'pending',
  }))
  const first = criteria[0]
  if (!first) return wakeMouth(session, ownerAgentId, 'answer')
  const coordinatorId = session.agents.some((agent) => agent.id === 'staff') ? 'staff' : focused
  const goal: GoalRun = {
    id: nextId('goal'),
    text: objective,
    coordinatorId,
    ownerAgentId,
    criteria,
    receipts: [],
    status: widgetFirst ? 'waiting_user' : 'running',
    activeCriterionId: first.id,
  }
  let next = putGoal(session, goal)
  if (widgetFirst) {
    return offerLandWidget(next, goal, first)
  }
  next = { ...next, jobs: [...next.jobs, criterionJob(goal, first, prior)] }
  return wakeMouth(next, ownerAgentId, 'working')
}

function criterionJob(goal: GoalRun, criterion: GoalCriterion, prior: string): JobHandle {
  const ctx = goalLaunchContext(goal, criterion)
  return {
    id: nextId('job'),
    ownerAgentId: goal.ownerAgentId,
    goal: jobGoal(criterion.work, prior, criterion.kind),
    status: 'running',
    kind: criterion.kind,
    goalId: goal.id,
    criterionId: criterion.id,
    objective: ctx.objective,
    unmetCriteria: ctx.unmetCriteria,
    evidence: ctx.evidence,
  }
}

function ackLine(name: string): string {
  if (name === 'Kernel') return 'On it.'
  if (name === 'Research') return 'Looking.'
  return 'Telling them.'
}

export function hasUserMessage(session: Session, agentId: AgentId): boolean {
  const row = session.threads[agentId]
  if (!row) return false
  return row.items.some((item) => item.kind === 'msg' && item.from === 'user')
}

export function introTurnId(agentId: AgentId): string {
  return `intro:${agentId}`
}

/** First-open mouth. Not must_first. Send stays Send. */
export function maybeIntro(session: Session, agentId: AgentId, introPlayedAt: string | null): Session {
  if (!session.threads[agentId]) return session
  if (introPlayedAt) return session
  const row = thread(session, agentId)
  if (hasUserMessage(session, agentId)) return session
  if (row.mouth !== 'idle') return session
  return wakeMouth(session, agentId, 'intro')
}

export function pendingMouthTurns(
  session: Session,
): { agentId: AgentId; userText: string; itemId: string; mode: 'chat' | 'assess' | 'intro' }[] {
  const pending: { agentId: AgentId; userText: string; itemId: string; mode: 'chat' | 'assess' | 'intro' }[] = []
  for (const row of Object.values(session.threads)) {
    if (row.mouth === 'intro') {
      pending.push({ agentId: row.agentId, userText: '', itemId: introTurnId(row.agentId), mode: 'intro' })
      continue
    }
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
  const row = thread(session, agentId)
  const focused = session.activeAgentId
  if (row.mouth === 'intro') {
    const line = sanitizeSpeak(spoken).trim()
    let next = line ? speak(session, agentId, line, focused) : session
    next = wakeMouth(next, agentId, 'idle')
    return finishBatch(next, agentId)
  }
  if (row.mouth !== 'answer') return session
  const emit = parseMouthEmit(spoken)
  if (emit?.kind === 'widget') {
    const next = emitWidget(session, agentId, emit.widget)
    return finishBatch(next, agentId)
  }
  if (emit?.kind === 'secret-request') {
    const next = emitSecretRequest(session, agentId, emit.connectorId)
    if (next === session) {
      let fallback = speak(session, agentId, 'Need a connector grant.', focused)
      fallback = wakeMouth(fallback, agentId, 'idle')
      return finishBatch(fallback, agentId)
    }
    return finishBatch(next, agentId)
  }
  const from = inboundCoordinatorId(session, agentId)
  let next = speak(session, agentId, sanitizeSpeak(spoken), focused)
  next = wakeMouth(next, agentId, 'idle')
  next = coordinatorReturn(next, from, agentId, spoken, focused)
  return finishBatch(next, agentId)
}

function inboundCoordinatorId(session: Session, agentId: AgentId): AgentId | null {
  const row = session.threads[agentId]
  if (!row) return null
  const items = row.items
  let lastUser = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item?.kind === 'msg' && item.from === 'user') {
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
    next = speak(next, agentId, returnBeat(name, last.text), session.activeAgentId)
    return finishBatch(next, agentId)
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

function matchingGoal(session: Session, job: JobHandle): GoalRun | undefined {
  if (!job.goalId) return undefined
  return sessionGoals(session.goals).find((row) => row.id === job.goalId)
}

function matchingCriterion(goal: GoalRun, job: JobHandle): GoalCriterion | undefined {
  if (job.criterionId) return goal.criteria.find((row) => row.id === job.criterionId)
  return goal.criteria.find((row) => row.status === 'running' && row.kind === job.kind)
}

function addReceipt(goal: GoalRun, criterionId: string, jobId: string, spoken: string, ok: boolean): GoalReceipt[] {
  const receipt: GoalReceipt = {
    id: nextId('rcpt'),
    criterionId,
    jobId,
    spoken: sanitizeSpeak(spoken),
    ok,
    at: Date.now(),
  }
  return [...goal.receipts, receipt]
}

function markCriterion(goal: GoalRun, criterionId: string, status: GoalCriterion['status']): GoalRun {
  return {
    ...goal,
    criteria: goal.criteria.map((row) => (row.id === criterionId ? { ...row, status } : row)),
  }
}

function closeGoalThenReturn(
  session: Session,
  goal: GoalRun,
  ownerId: AgentId,
  from: AgentId | null,
  spoken: string,
  focused: AgentId,
): Session {
  const next = putGoal(session, { ...goal, activeCriterionId: undefined })
  return coordinatorReturn(wakeMouth(next, ownerId, 'idle'), from, ownerId, spoken, focused)
}

function bookNextOrClose(
  session: Session,
  goal: GoalRun,
  spoken: string,
  focused: AgentId,
  from: AgentId | null,
): Session {
  const prior = priorUserText(thread(session, goal.ownerAgentId).items)
  const nextCrit = nextUnmetCriterion(goal)
  if (!nextCrit) {
    const settled = goal.criteria.every((row) => row.status === 'met' || row.status === 'skipped')
    const complete = everyCriterionMet(goal) || (settled && goal.criteria.some((row) => row.status === 'met'))
    const cancelled = settled && !complete
    return closeGoalThenReturn(
      session,
      { ...goal, status: complete ? 'complete' : cancelled ? 'cancelled' : 'failed' },
      goal.ownerAgentId,
      from,
      spoken,
      focused,
    )
  }
  if (isLandKind(nextCrit.kind)) {
    const waiting = {
      ...goal,
      status: 'waiting_user' as const,
      activeCriterionId: nextCrit.id,
    }
    const next = putGoal(session, waiting)
    return offerLandWidget(next, waiting, nextCrit)
  }
  const running = {
    ...markCriterion(goal, nextCrit.id, 'running'),
    status: 'running' as const,
    activeCriterionId: nextCrit.id,
  }
  let next = putGoal(session, running)
  next = { ...next, jobs: [...next.jobs, criterionJob(running, nextCrit, prior)] }
  return wakeMouth(next, running.ownerAgentId, 'working')
}

function failGoal(
  session: Session,
  goal: GoalRun,
  spoken: string,
  focused: AgentId,
): Session {
  const failed = { ...goal, status: 'failed' as const, activeCriterionId: undefined }
  let next = putGoal(session, failed)
  next = wakeMouth(next, failed.ownerAgentId, 'idle')
  if (failed.coordinatorId === failed.ownerAgentId || !next.threads[failed.coordinatorId]) return next
  const name = next.agents.find((agent) => agent.id === failed.ownerAgentId)?.name ?? 'They'
  next = speak(next, failed.coordinatorId, goalBlocker(name, spoken), focused)
  return wakeMouth(next, failed.coordinatorId, 'idle')
}

export function waitJobExternal(session: Session, jobId: string): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const goal = matchingGoal(session, job)
  if (!goal || goal.status === 'waiting_external') return session
  if (goal.status !== 'running' && goal.status !== 'planning') return session
  return putGoal(session, { ...goal, status: 'waiting_external' })
}

/** Park a running job. Criterion stays unmet. Staff owns the blocker, not the feed. */
export function waitJobUser(
  session: Session,
  jobId: string,
  spoken: string,
  source: GoalBlockerSource = 'staff',
): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const goal = matchingGoal(session, job)
  const criterion = goal ? matchingCriterion(goal, job) : undefined
  if (!goal || !criterion) return session
  if (goal.status === 'complete' || goal.status === 'cancelled') return session
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'waiting' as const } : item,
    ),
  }
  next = wakeMouth(next, job.ownerAgentId, 'idle')
  const waiting: GoalRun = {
    ...markCriterion(goal, criterion.id, 'blocked'),
    status: 'waiting_user',
    activeCriterionId: criterion.id,
    blocker: {
      reason: boundGoalEvidence(spoken),
      criterionId: criterion.id,
      jobId: job.id,
      at: Date.now(),
      source,
    },
  }
  return putGoal(next, waiting)
}

/** User repaired the condition. Clear the blocker and book a fresh job for that criterion. */
export function retryGoal(session: Session, goalId: string): Session {
  const goal = sessionGoals(session.goals).find((row) => row.id === goalId)
  if (!goal || goal.status !== 'waiting_user' || !goal.blocker) return session
  const criterion = goal.criteria.find((row) => row.id === goal.blocker?.criterionId)
  if (!criterion) return session
  const prior = priorUserText(thread(session, goal.ownerAgentId).items)
  const running: GoalRun = {
    ...markCriterion(goal, criterion.id, 'running'),
    status: 'running',
    activeCriterionId: criterion.id,
  }
  delete running.blocker
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.goalId === goalId && item.status === 'waiting' ? { ...item, status: 'failed' as const } : item,
    ),
  }
  next = putGoal(next, running)
  next = { ...next, jobs: [...next.jobs, criterionJob(running, criterion, prior)] }
  return wakeMouth(next, running.ownerAgentId, 'working')
}

/** Settle the goal and its open jobs. Does not book or dispatch. */
export function cancelGoal(session: Session, goalId: string): Session {
  const goal = sessionGoals(session.goals).find((row) => row.id === goalId)
  if (!goal) return session
  if (goal.status === 'complete' || goal.status === 'cancelled') return session
  const cancelled: GoalRun = {
    ...goal,
    status: 'cancelled',
    activeCriterionId: undefined,
  }
  delete cancelled.blocker
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.goalId === goalId && (item.status === 'running' || item.status === 'waiting')
        ? { ...item, status: 'failed' as const }
        : item,
    ),
  }
  next = putGoal(next, cancelled)
  next = dropJobSteer(next, goal.ownerAgentId)
  next = wakeMouth(next, goal.ownerAgentId, 'idle')
  return finishBatch(next, goal.ownerAgentId)
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
  const goal = matchingGoal(next, job)
  const criterion = goal ? matchingCriterion(goal, job) : undefined
  if (!goal || !criterion) {
    next = coordinatorReturn(next, from, job.ownerAgentId, spoken, focused)
    return finishBatch(next, job.ownerAgentId)
  }
  const reconciled = {
    ...markCriterion(goal, criterion.id, 'met'),
    receipts: addReceipt(goal, criterion.id, job.id, spoken, true),
  }
  next = bookNextOrClose(next, reconciled, spoken, focused, from)
  return finishBatch(next, job.ownerAgentId)
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
  const goal = matchingGoal(next, job)
  const criterion = goal ? matchingCriterion(goal, job) : undefined
  if (!goal || !criterion) {
    next = coordinatorReturn(next, from, job.ownerAgentId, spoken, focused)
    return finishBatch(next, job.ownerAgentId)
  }
  const failed = {
    ...markCriterion(goal, criterion.id, 'failed'),
    receipts: addReceipt(goal, criterion.id, job.id, spoken, false),
  }
  next = failGoal(next, failed, spoken, focused)
  return finishBatch(next, job.ownerAgentId)
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
  const goal = matchingGoal(next, job)
  if (goal) {
    next = putGoal(next, { ...goal, status: 'cancelled', activeCriterionId: undefined })
  }
  next = dropJobSteer(next, job.ownerAgentId)
  next = wakeMouth(next, job.ownerAgentId, 'idle')
  return finishBatch(next, job.ownerAgentId)
}

function putComputer(session: Session, worker: ComputerWorker): Session {
  const workers = session.computerWorkers ?? []
  const hit = workers.findIndex((row) => row.id === worker.id)
  const computerWorkers = hit < 0 ? [...workers, worker] : workers.map((row) => (row.id === worker.id ? worker : row))
  return { ...session, computerWorkers }
}

function liveComputerOn(session: Session, agentId: AgentId): boolean {
  return (session.computerWorkers ?? []).some(
    (row) =>
      row.ownerAgentId === agentId && (row.status === 'running' || row.status === 'waiting_operator'),
  )
}

function setComputerBusy(session: Session, agentId: AgentId, busy: boolean): Session {
  if (!session.threads[agentId]) return session
  return setThread(session, agentId, { computerBusy: busy })
}

/** Job-shaped computer worker. Mouth stays Send via computerBusy. Staff still owns GoalRun. */
export function bookComputer(session: Session, ownerAgentId: AgentId, goal: string): Session {
  if (!session.threads[ownerAgentId]) return session
  const worker: ComputerWorker = {
    id: nextId('comp'),
    ownerAgentId,
    display: displayForMouth(ownerAgentId),
    goal,
    status: 'running',
  }
  let next = putComputer(session, worker)
  next = setComputerBusy(next, ownerAgentId, true)
  return wakeMouth(next, ownerAgentId, 'working')
}

function finishComputer(
  session: Session,
  workerId: string,
  spoken: string,
  status: 'complete' | 'failed',
  screenshotPath?: string,
): Session {
  const worker = (session.computerWorkers ?? []).find((row) => row.id === workerId)
  if (!worker) return session
  if (worker.status !== 'running' && worker.status !== 'waiting_operator') return session
  const focused = session.activeAgentId
  let next = putComputer(session, { ...worker, status, screenshotPath })
  next = speak(next, worker.ownerAgentId, sanitizeSpeak(spoken), focused)
  next = setComputerBusy(next, worker.ownerAgentId, liveComputerOn(next, worker.ownerAgentId))
  next = wakeMouth(next, worker.ownerAgentId, 'idle')
  return finishBatch(next, worker.ownerAgentId)
}

export function completeComputer(
  session: Session,
  workerId: string,
  spoken = 'Done.',
  screenshotPath?: string,
): Session {
  return finishComputer(session, workerId, spoken, 'complete', screenshotPath)
}

export function failComputer(session: Session, workerId: string, spoken = "Didn't land."): Session {
  return finishComputer(session, workerId, spoken, 'failed')
}

export function waitComputerOperator(
  session: Session,
  workerId: string,
  instruction: string,
  url = '',
): Session {
  const worker = (session.computerWorkers ?? []).find((row) => row.id === workerId)
  if (!worker || worker.status !== 'running') return session
  let next = putComputer(session, { ...worker, status: 'waiting_operator', instruction })
  next = setComputerBusy(next, worker.ownerAgentId, true)
  const handoffUrl = url || parseDeskUrl(worker.goal) || 'about:blank'
  return {
    ...next,
    deskHandoff: {
      agentId: worker.ownerAgentId,
      url: handoffUrl,
      instruction,
    },
  }
}

export function resumeComputer(session: Session, agentId?: AgentId): Session {
  const computerWorkers = (session.computerWorkers ?? []).map((row) => {
    if (row.status !== 'waiting_operator') return row
    if (agentId && row.ownerAgentId !== agentId) return row
    return { ...row, status: 'running' as const }
  })
  let next: Session = { ...session, computerWorkers }
  const owners = new Set(
    computerWorkers
      .filter((row) => row.status === 'running' || row.status === 'waiting_operator')
      .map((row) => row.ownerAgentId),
  )
  for (const owner of owners) next = setComputerBusy(next, owner, true)
  return next
}

export function runningComputerWorkers(session: Session): ComputerWorker[] {
  return (session.computerWorkers ?? []).filter((row) => row.status === 'running')
}

function coordinatorSeat(session: Session, fallback: AgentId): AgentId {
  if (session.threads.staff) return 'staff'
  return fallback
}

function patchItem(session: Session, itemId: string, patch: (item: FeedItem) => FeedItem): Session {
  for (const agentId of Object.keys(session.threads)) {
    const row = session.threads[agentId]
    if (!row) continue
    const hit = row.items.findIndex((item) => item.id === itemId)
    if (hit < 0) continue
    const items = row.items.map((item, index) => (index === hit ? patch(item) : item))
    return setThread(session, agentId, { items })
  }
  return session
}

function findFeedItem(session: Session, itemId: string): FeedItem | undefined {
  for (const row of Object.values(session.threads)) {
    const hit = row.items.find((item) => item.id === itemId)
    if (hit) return hit
  }
  return undefined
}

function dismissMoveOnWidgets(session: Session, agentId: AgentId): Session {
  const row = session.threads[agentId]
  if (!row) return session
  const items = row.items.map((item) => {
    if (item.kind === 'widget' && item.status === 'open' && item.widget.dismissOnMoveOn) {
      return { ...item, status: 'dismissed' as const }
    }
    return item
  })
  return setThread(session, agentId, { items })
}

function emitWidgetItem(
  session: Session,
  agentId: AgentId,
  spec: QuestionWidget,
  extra: {
    purpose?: WidgetPurpose
    goalId?: string
    criterionId?: string
    workerId?: string
  } = {},
): Session {
  if (!session.threads[agentId]) return session
  const normalized = normalizeWidget(spec)
  if (!normalized) return session
  const purpose = extra.purpose ?? 'ask'
  if (widgetDismissOnMoveOn(purpose, spec.dismissOnMoveOn)) normalized.dismissOnMoveOn = true
  else delete normalized.dismissOnMoveOn
  const item: FeedItem = {
    kind: 'widget',
    id: nextId('item'),
    agentId,
    widget: normalized,
    purpose,
    status: 'open',
    goalId: extra.goalId,
    criterionId: extra.criterionId,
    workerId: extra.workerId,
    at: Date.now(),
  }
  let next = append(session, agentId, item, session.activeAgentId)
  return wakeMouth(next, agentId, 'idle')
}

export function emitWidget(
  session: Session,
  agentId: AgentId,
  spec: QuestionWidget,
  extra: {
    purpose?: WidgetPurpose
    goalId?: string
    criterionId?: string
    workerId?: string
  } = {},
): Session {
  return emitWidgetItem(session, agentId, spec, extra)
}

function offerLandWidget(session: Session, goal: GoalRun, criterion: GoalCriterion): Session {
  const seat = coordinatorSeat(session, goal.coordinatorId)
  const purpose: WidgetPurpose = criterion.kind === 'ship' ? 'ship' : 'merge'
  let next = emitWidgetItem(session, seat, landWidgetForKind(criterion.kind), {
    purpose,
    goalId: goal.id,
    criterionId: criterion.id,
  })
  next = wakeMouth(next, goal.ownerAgentId, 'idle')
  return next
}

export function emitSecretRequest(session: Session, agentId: AgentId, connectorId: string): Session {
  if (!session.threads[agentId]) return session
  const id = connectorId.trim()
  if (!id || !knownConnectorId(id)) return session
  const item: FeedItem = {
    kind: 'secret-request',
    id: nextId('item'),
    agentId,
    connectorId: id,
    status: 'open',
    at: Date.now(),
  }
  let next = append(session, agentId, item, session.activeAgentId)
  return wakeMouth(next, agentId, 'idle')
}

export function answerWidget(session: Session, itemId: string, answer: WidgetAnswer): Session {
  const item = findFeedItem(session, itemId)
  if (!item || item.kind !== 'widget' || item.status !== 'open') return session
  const values = answer.values.filter((row) => row.trim())
  const custom = answer.custom?.trim()
  const nextAnswer: WidgetAnswer = { values }
  if (custom) nextAnswer.custom = custom
  let next = patchItem(session, itemId, (row) =>
    row.kind === 'widget' ? { ...row, status: 'answered' as const, answer: nextAnswer } : row,
  )
  const purpose = item.purpose ?? 'ask'
  if (purpose === 'merge' || purpose === 'ship') return resolveLandWidget(next, item, values)
  if (purpose === 'host') return resolveHostWidget(next, item, values)
  const reply = widgetReplyText(item.widget, nextAnswer)
  if (!reply) return next
  return send(wakeMouth(next, next.activeAgentId, 'idle'), reply)
}

export function dismissWidget(session: Session, itemId: string): Session {
  const item = findFeedItem(session, itemId)
  if (!item || item.kind !== 'widget' || item.status !== 'open') return session
  let next = patchItem(session, itemId, (row) =>
    row.kind === 'widget' ? { ...row, status: 'dismissed' as const } : row,
  )
  if (item.purpose === 'merge' || item.purpose === 'ship') {
    return resolveLandWidget(next, item, ['cancel'])
  }
  if (item.purpose === 'host' && item.workerId) {
    return failComputer(next, item.workerId, 'Not running that on your Mac.')
  }
  return next
}

function resolveLandWidget(session: Session, item: Extract<FeedItem, { kind: 'widget' }>, values: string[]): Session {
  const goal = sessionGoals(session.goals).find((row) => row.id === item.goalId)
  const criterion = goal?.criteria.find((row) => row.id === item.criterionId)
  if (!goal || !criterion) return session
  const focused = session.activeAgentId
  if (values.includes('cancel')) {
    const skipped: GoalRun = {
      ...goal,
      criteria: goal.criteria.map((row) =>
        isLandKind(row.kind) && (row.status === 'pending' || row.id === criterion.id)
          ? { ...row, status: 'skipped' as const }
          : row,
      ),
    }
    delete skipped.blocker
    return bookNextOrClose(putGoal(session, skipped), skipped, 'Cancelled.', focused, null)
  }
  const running = {
    ...markCriterion(goal, criterion.id, 'running'),
    status: 'running' as const,
    activeCriterionId: criterion.id,
  }
  delete running.blocker
  const prior = priorUserText(thread(session, goal.ownerAgentId).items)
  let next = putGoal(session, running)
  next = { ...next, jobs: [...next.jobs, criterionJob(running, criterion, prior)] }
  return wakeMouth(next, running.ownerAgentId, 'working')
}

function resolveHostWidget(session: Session, item: Extract<FeedItem, { kind: 'widget' }>, values: string[]): Session {
  if (!item.workerId) return session
  if (values.includes('cancel')) {
    return failComputer(session, item.workerId, 'Not running that on your Mac.')
  }
  const worker = (session.computerWorkers ?? []).find((row) => row.id === item.workerId)
  if (!worker || (worker.status !== 'waiting_operator' && worker.status !== 'running')) return session
  let next = putComputer(session, { ...worker, status: 'running', hostAllowed: true })
  next = setComputerBusy(next, worker.ownerAgentId, true)
  return next
}

export function fulfillSecretRequest(session: Session, itemId: string, value: string): Session {
  const item = findFeedItem(session, itemId)
  if (!item || item.kind !== 'secret-request' || item.status !== 'open') return session
  const secret = value.trim()
  if (!secret) return session
  if (!writeConnectorSecret(item.connectorId, secret)) return session
  return patchItem(session, itemId, (row) =>
    row.kind === 'secret-request' ? { ...row, status: 'saved' as const, configured: true } : row,
  )
}

export function dismissSecretRequest(session: Session, itemId: string): Session {
  const item = findFeedItem(session, itemId)
  if (!item || item.kind !== 'secret-request' || item.status !== 'open') return session
  return patchItem(session, itemId, (row) =>
    row.kind === 'secret-request' ? { ...row, status: 'dismissed' as const } : row,
  )
}

export function waitComputerHost(
  session: Session,
  workerId: string,
  prompt = HOST_APPROVAL_PROMPT,
): Session {
  const worker = (session.computerWorkers ?? []).find((row) => row.id === workerId)
  if (!worker || worker.status !== 'running') return session
  let next = putComputer(session, { ...worker, status: 'waiting_operator', instruction: prompt })
  next = setComputerBusy(next, worker.ownerAgentId, true)
  return emitWidgetItem(next, worker.ownerAgentId, hostApprovalWidget(prompt), {
    purpose: 'host',
    workerId,
  })
}

export function runningJobs(session: Session): JobHandle[] {
  return session.jobs.filter((job) => job.status === 'running')
}

function isHostLand(job: JobHandle): boolean {
  return job.kind === 'promote' || job.kind === 'ship'
}

/** UI still lists every running job. Dispatch at most one host land per owner. */
export function dispatchableJobs(session: Session): JobHandle[] {
  const hostOwner = new Set<AgentId>()
  const ready: JobHandle[] = []
  for (const job of runningJobs(session)) {
    if (!isHostLand(job)) {
      ready.push(job)
      continue
    }
    if (hostOwner.has(job.ownerAgentId)) continue
    hostOwner.add(job.ownerAgentId)
    ready.push(job)
  }
  return ready
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
