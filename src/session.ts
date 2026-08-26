import {
  type Agent,
  type AgentId,
  type FeedItem,
  type JobHandle,
  type MouthState,
  type Thread,
  composerEnterBusy,
  jobKindFor,
  mentionedAgentIds,
  needsFanoutConfirm,
  nextId,
  sanitizeSpeak,
  visibleAgents,
} from './domain'

export type Session = {
  agents: Agent[]
  activeAgentId: AgentId
  threads: Record<AgentId, Thread>
  jobs: JobHandle[]
  pendingFanout: { text: string; targets: AgentId[] } | null
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
  return setThread(session, session.activeAgentId, { draft: text })
}

export function dismissFanout(session: Session): Session {
  return { ...session, pendingFanout: null }
}

export function confirmFanout(session: Session): Session {
  if (!session.pendingFanout) return session
  return send(session, session.pendingFanout.text)
}

function staffParaphrase(text: string): string {
  const trimmed = text.replace(/^@\S+\s*/g, '').trim()
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}

function speak(session: Session, agentId: AgentId, text: string, focused: AgentId): Session {
  return append(
    session,
    agentId,
    { kind: 'msg', id: nextId('item'), from: 'agent', agentId, text },
    focused,
  )
}

function wakeMouth(session: Session, agentId: AgentId, mouth: MouthState): Session {
  return setThread(session, agentId, { mouth })
}

/** User send on the focused mouth. Jobs do not lock other mouths. */
export function send(session: Session, raw: string): Session {
  const text = raw.trim()
  if (!text) return session
  const active = session.activeAgentId
  if (composerEnterBusy(thread(session, active).mouth)) return session

  const mentioned = mentionedAgentIds(text, visibleAgents(session.agents))
  if (needsFanoutConfirm(mentioned) && session.pendingFanout == null) {
    return { ...session, pendingFanout: { text, targets: mentioned } }
  }
  const confirmedFanout = session.pendingFanout
  const next: Session = { ...session, pendingFanout: null }
  const body = confirmedFanout?.text ?? text
  const targets =
    confirmedFanout?.targets ?? (mentioned.length > 0 ? mentioned : [active])

  if (targets.length > 1) {
    return fanout(next, body, targets)
  }
  return deliverTo(next, targets[0], body, active)
}

function fanout(session: Session, text: string, targets: AgentId[]): Session {
  const focused = session.activeAgentId
  let next = append(
    session,
    focused,
    { kind: 'msg', id: nextId('item'), from: 'user', agentId: focused, text },
    focused,
  )
  next = setThread(next, focused, { draft: '', mouth: 'ack' })
  next = speak(next, focused, 'Telling the others.', focused)
  const note = staffParaphrase(text)
  for (const target of targets) {
    if (target === focused) continue
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

function deliverTo(session: Session, agentId: AgentId, text: string, focused: AgentId): Session {
  let next = append(
    session,
    agentId,
    { kind: 'msg', id: nextId('item'), from: 'user', agentId, text },
    focused,
  )
  next = setThread(next, agentId, {
    draft: agentId === focused ? '' : thread(next, agentId).draft,
    mouth: 'must_first',
  })
  const agent = next.agents.find((item) => item.id === agentId)
  const kind = jobKindFor(agentId, text)
  if (kind) {
    next = speak(next, agentId, ackLine(agent?.name ?? 'Agent'), focused)
    next = wakeMouth(next, agentId, 'ack')
    const handle: JobHandle = {
      id: nextId('job'),
      ownerAgentId: agentId,
      goal: staffParaphrase(text),
      status: 'running',
      kind,
    }
    next = { ...next, jobs: [...next.jobs, handle] }
    return wakeMouth(next, agentId, 'working')
  }
  return wakeMouth(next, agentId, 'answer')
}

function ackLine(name: string): string {
  if (name === 'Kernel') return 'On it.'
  if (name === 'Research') return 'Looking.'
  return 'Telling them.'
}

export function pendingMouthTurns(
  session: Session,
): { agentId: AgentId; userText: string; itemId: string }[] {
  const pending: { agentId: AgentId; userText: string; itemId: string }[] = []
  for (const row of Object.values(session.threads)) {
    if (row.mouth !== 'answer') continue
    const last = row.items.at(-1)
    if (last?.kind === 'msg' && last.from === 'user') {
      pending.push({ agentId: row.agentId, userText: last.text, itemId: last.id })
    }
  }
  return pending
}

export function completeMouth(session: Session, agentId: AgentId, spoken: string): Session {
  if (thread(session, agentId).mouth !== 'answer') return session
  const focused = session.activeAgentId
  const next = speak(session, agentId, sanitizeSpeak(spoken), focused)
  return wakeMouth(next, agentId, 'idle')
}

export function failMouth(session: Session, agentId: AgentId, spoken: string): Session {
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

export function completeJob(session: Session, jobId: string, spoken = 'Done.'): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const focused = session.activeAgentId
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'complete' as const } : item,
    ),
  }
  next = wakeMouth(next, job.ownerAgentId, 'must_deliver')
  next = speak(next, job.ownerAgentId, sanitizeSpeak(spoken), focused)
  return wakeMouth(next, job.ownerAgentId, 'idle')
}

export function failJob(session: Session, jobId: string, spoken = "Didn't land."): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  const focused = session.activeAgentId
  let next: Session = {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'failed' as const } : item,
    ),
  }
  next = wakeMouth(next, job.ownerAgentId, 'must_deliver')
  next = speak(next, job.ownerAgentId, sanitizeSpeak(spoken), focused)
  return wakeMouth(next, job.ownerAgentId, 'idle')
}

export function stopJob(session: Session, jobId: string): Session {
  const job = session.jobs.find((item) => item.id === jobId)
  if (!job || job.status !== 'running') return session
  return {
    ...session,
    jobs: session.jobs.map((item) =>
      item.id === jobId ? { ...item, status: 'failed' as const } : item,
    ),
  }
}

export function runningJobs(session: Session): JobHandle[] {
  return session.jobs.filter((job) => job.status === 'running')
}
