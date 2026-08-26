import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import {
  addLiveAgent,
  askDelete,
  attachPmJob,
  completeJob,
  completeMouth,
  confirmFanout,
  dismissDelete,
  dropLiveAgent,
  dropPendingPath,
  failJob,
  idleOrphanMouths,
  queuePaths,
  send,
  setActive,
  setDraft,
  type Session,
} from '../src/session'

function fresh(): Session {
  resetIdsForTests()
  return {
    agents: DEFAULT_AGENTS,
    activeAgentId: 'staff',
    threads: emptyThreads(DEFAULT_AGENTS),
    jobs: [],
    pendingFanout: null,
  }
}

describe('teammate session', () => {
  test('Staff send succeeds while Kernel job is running', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].ownerAgentId).toBe('kernel')
    expect(s.jobs[0].kind).toBe('implement')
    expect(s.threads.kernel.mouth).toBe('working')
    s = setActive(s, 'staff')
    s = send(s, ' meanwhile, what is the pin?')
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent')).toBe(
      false,
    )
    s = completeMouth(s, 'staff', 'The pin is grok-4.6 Extra High plus Fast.')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent')).toBe(
      true,
    )
    expect(s.jobs).toHaveLength(1)
    expect(s.threads.kernel.mouth).toBe('working')
  })

  test('fan-out to 3+ agents is confirm-then-send; dismiss is no send', () => {
    let s = send(fresh(), '@Staff @Kernel @Research check the ledger replay')
    expect(s.pendingFanout?.targets).toEqual(['staff', 'kernel', 'research'])
    expect(s.threads.staff.items).toHaveLength(0)
    s = { ...s, pendingFanout: null }
    expect(s.threads.kernel.items).toHaveLength(0)
  })

  test('confirming fan-out delivers notes', () => {
    let s = send(fresh(), '@Staff @Kernel @Research check the ledger replay')
    s = confirmFanout(s)
    expect(s.pendingFanout).toBeNull()
    expect(s.threads.kernel.items.length).toBeGreaterThan(0)
  })

  test('job completion wakes the owner mouth and unread if unfocused', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    const jobId = s.jobs[0].id
    expect(s.jobs[0].pmJobId).toBeUndefined()
    s = attachPmJob(s, jobId, 'job_deadbeef')
    expect(s.jobs[0].pmJobId).toBe('job_deadbeef')
    s = setActive(s, 'staff')
    s = completeJob(s, jobId, 'The ledger replay is deterministic.')
    expect(s.jobs[0].status).toBe('complete')
    expect(s.threads.kernel.unread).toBeGreaterThan(0)
    expect(s.activeAgentId).toBe('staff')
    const last = s.threads.kernel.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') {
      expect(last.from).toBe('agent')
      expect(last.text).toBe('The ledger replay is deterministic.')
      expect(last.text).not.toMatch(/job_/)
    }
  })

  test('failed PM job still wakes the owner mouth', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    const jobId = s.jobs[0].id
    s = setActive(s, 'staff')
    s = failJob(s, jobId, "Didn't land.")
    expect(s.jobs[0].status).toBe('failed')
    expect(s.threads.kernel.unread).toBeGreaterThan(0)
  })

  test('Staff never dispatches a job; mouth waits for durable reply', () => {
    const s = send(fresh(), 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent')).toBe(
      false,
    )
  })

  test('Research lookup dispatches analyze, not implement', () => {
    let s = setActive(fresh(), 'research')
    s = send(s, 'Look up why Send stays Send in Automaton staff.')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].kind).toBe('analyze')
    expect(s.jobs[0].ownerAgentId).toBe('research')
  })

  test('Kernel lookup is analyze, not implement', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Look up why Send stays Send in Automaton staff.')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].kind).toBe('analyze')
    expect(s.jobs[0].ownerAgentId).toBe('kernel')
  })

  test('draft is per thread', () => {
    let s = setDraft(fresh(), 'hello staff')
    s = setActive(s, 'kernel')
    expect(s.threads.staff.draft).toBe('hello staff')
    expect(s.threads.kernel.draft).toBe('')
  })

  test('a blank factory mouth does not dispatch jobs', () => {
    const bot = {
      id: 'agent_1',
      name: 'New Bot',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    let s = addLiveAgent(fresh(), bot)
    expect(s.activeAgentId).toBe('agent_1')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.agent_1.mouth).toBe('answer')
  })

  test('delete confirm then drop removes the thread', () => {
    const bot = {
      id: 'agent_1',
      name: 'New Bot',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    let s = addLiveAgent(fresh(), bot, false)
    expect(s.activeAgentId).toBe('staff')
    s = askDelete(s, 'agent_1')
    expect(s.pendingDelete).toBe('agent_1')
    s = dismissDelete(s)
    expect(s.pendingDelete).toBeNull()
    s = askDelete(s, 'agent_1')
    s = dropLiveAgent(s, 'agent_1')
    expect(s.agents.map((agent) => agent.id)).toEqual(['staff', 'kernel', 'research'])
    expect(s.threads.agent_1).toBeUndefined()
  })

  test('image-only send lands attachment ids and a blank kit still answers', () => {
    let s = send(fresh(), '', ['att_1'])
    expect(s.threads.staff.items).toHaveLength(1)
    const item = s.threads.staff.items[0]
    expect(item.kind).toBe('msg')
    if (item.kind === 'msg') {
      expect(item.text).toBe('')
      expect(item.attachmentIds).toEqual(['att_1'])
    }
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.staff.mouth).toBe('answer')
  })

  test('dropPendingPath removes one queued file and leaves the rest', () => {
    let s = queuePaths(fresh(), ['/tmp/a.docx', '/tmp/b.png'])
    expect(s.threads.staff.pendingPaths).toEqual(['/tmp/a.docx', '/tmp/b.png'])
    s = dropPendingPath(s, '/tmp/a.docx')
    expect(s.threads.staff.pendingPaths).toEqual(['/tmp/b.png'])
    s = dropPendingPath(s, '/tmp/missing')
    expect(s.threads.staff.pendingPaths).toEqual(['/tmp/b.png'])
  })

  test('hydrate idles orphan mouth turns and keeps a flying job working', () => {
    let s = send(fresh(), 'Hello, what is your name?')
    expect(s.threads.staff.mouth).toBe('answer')
    s = setActive(s, 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.threads.kernel.mouth).toBe('working')
    s = idleOrphanMouths(s)
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.kernel.mouth).toBe('working')
  })
})
