import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPendingSendView, emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import { writeProfile } from '../src/runtime/profile'
import { queryFirst } from '../src/runtime/working-set'
import { openStaffStore } from '../src/runtime/store'
import {
  addLiveAgent,
  answerWidget,
  attachPmJob,
  bookComputer,
  completeComputer,
  completeJob,
  completeMouth,
  drainSteer,
  confirmFanout,
  dropLiveAgent,
  dropPendingPath,
  failJob,
  failMouth,
  hasUserMessage,
  idleOrphanMouths,
  offerSisterHop,
  maybeIntro,
  noteJobStatus,
  pendingMouthTurns,
  queuePaths,
  finishSend,
  paintSend,
  send,
  setActive,
  setDraft,
  stopJob,
  stopMouth,
  waitComputerOperator,
  waitJobExternal,
  waitJobUser,
  retryGoal,
  cancelGoal,
  dispatchableJobs,
  resumeComputer,
  runningComputerWorkers,
  runningJobs,
  type Session,
} from '../src/session'
import { composerEnterBusy, isMouthBusy, shouldQueueSteer } from '../src/domain'

function fresh(): Session {
  resetIdsForTests()
  const agents = staffWithSisters()
  return {
    agents,
    activeAgentId: 'staff',
    threads: emptyThreads(agents),
    jobs: [],
    pendingFanout: null,
  }
}

function openWidget(session: Session, agentId = 'staff') {
  return session.threads[agentId]?.items.find((item) => item.kind === 'widget' && item.status === 'open')
}

function confirmLand(session: Session, value: 'merge' | 'ship', agentId = 'staff'): Session {
  const widget = openWidget(session, agentId)
  if (!widget || widget.kind !== 'widget') return session
  return answerWidget(session, widget.id, { values: [value] })
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

  test('Staff books implement when the line is a job and no sister is named', () => {
    const s = send(fresh(), 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].ownerAgentId).toBe('staff')
    expect(s.jobs[0].kind).toBe('implement')
    expect(s.threads.staff.mouth).toBe('working')
  })

  test('Staff looks at a named machine checkout instead of chatting Automaton internals', () => {
    const s = send(
      fresh(),
      'what script does puppetmaster have its model routing logic contained in?',
    )
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].ownerAgentId).toBe('staff')
    expect(s.jobs[0].kind).toBe('analyze')
    expect(s.threads.staff.mouth).toBe('working')
  })

  test("Staff product-stack ask books a look instead of offering to dispatch", () => {
    const dugout = {
      id: 'agent_d',
      name: 'Dugout',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), dugout]
    resetIdsForTests()
    const s = send(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      "What is Dugout's stack made up of?",
    )
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.kind).toBe('analyze')
    expect(s.jobs[0]?.ownerAgentId).toBe('staff')
    expect(s.threads.staff.mouth).toBe('working')
    expect(s.threads.staff.items.some((item) => item.kind === 'relay')).toBe(false)
  })

  test('Staff ask-Puppetmaster repo look books analyze on that mouth', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-pm-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_pm',
        name: 'Puppetmaster',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'hex',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-25T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const puppetmaster = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    try {
      const s = send(
        {
          agents: [...staffWithSisters(), puppetmaster],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), puppetmaster]),
          jobs: [],
          pendingFanout: null,
        },
        'Ask Puppetmaster to look at the repo and find the router logic.',
      )
      expect(s.threads.staff.mouth).toBe('idle')
      expect(s.jobs).toHaveLength(1)
      expect(s.jobs[0]?.kind).toBe('analyze')
      expect(s.jobs[0]?.ownerAgentId).toBe('agent_pm')
      expect(s.threads.agent_pm.mouth).toBe('working')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('Staff excerpt follow-up keeps the earlier product in the look goal', () => {
    let s = send(
      fresh(),
      'what script does puppetmaster have its model routing logic contained in?',
    )
    s = completeJob(s, s.jobs[0].id, 'Routing lives in puppetmaster/router.py.')
    s = send(s, 'can you show me some excerpts')
    expect(s.jobs).toHaveLength(2)
    expect(s.jobs[1].kind).toBe('analyze')
    expect(s.jobs[1].goal).toContain('continuing:')
    expect(s.jobs[1].goal).toContain('puppetmaster')
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

  test('drop removes a sister without changing the focused mouth', () => {
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
    s = dropLiveAgent(s, 'agent_1')
    expect(s.agents.map((agent) => agent.id)).toEqual(['staff', 'kernel', 'research'])
    expect(s.threads.agent_1).toBeUndefined()
    expect(s.activeAgentId).toBe('staff')
  })

  test('image-only send lands attachment ids and a blank kit still answers', () => {
    let s = send(fresh(), '', ['att_1'])
    expect(s.threads.staff.items).toHaveLength(1)
    const item = s.threads.staff.items[0]
    expect(item.kind).toBe('msg')
    if (item.kind === 'msg') {
      expect(item.text).toBe('')
      expect(item.attachmentIds).toEqual(['att_1'])
      expect(typeof item.at).toBe('number')
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

  test('Staff live-check of named products books analyze instead of chatting', () => {
    const s = send(fresh(), 'check Puppetmaster and Marionette for prs or open issues')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.kind).toBe('analyze')
    expect(s.jobs[0]?.ownerAgentId).toBe('staff')
    expect(s.threads.staff.mouth).toBe('working')
    expect(s.threads.staff.mouth).not.toBe('answer')
    expect(pendingMouthTurns(s)).toHaveLength(0)
  })

  test('Staff ping plus a repo ask books analyze, not a presence check', () => {
    const s = send(fresh(), 'Can you ping Kernel, do we have any PRs or open issues?')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.ownerAgentId).toBe('kernel')
    expect(s.jobs[0]?.kind).toBe('analyze')
    expect(s.threads.kernel.mouth).toBe('working')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Asking Kernel.',
      ),
    ).toBe(true)
    const note = s.threads.kernel.items.find((item) => item.kind === 'agent_note')
    expect(note?.kind === 'agent_note' && note.text.includes('PRs')).toBe(true)
    expect(note?.kind === 'agent_note' && note.text.includes('are you around')).toBe(false)
  })

  test('Staff ping plus leftover work sends the remainder and books analyze', () => {
    const s = send(fresh(), 'hey ping Kernel and check for open PRs')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.kind).toBe('analyze')
    expect(s.jobs[0]?.ownerAgentId).toBe('kernel')
    expect(s.threads.kernel.mouth).toBe('working')
    const note = s.threads.kernel.items.find((item) => item.kind === 'agent_note')
    expect(note?.kind === 'agent_note' && note.text).toBe('Check for open PRs')
  })

  test('Staff ping asks Research without a job and skips OpenRouter on Staff', () => {
    const s = send(fresh(), 'Can you ask research if he is online?')
    expect(s.pendingFanout).toBeNull()
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.activeAgentId).toBe('staff')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Asking Research.',
      ),
    ).toBe(true)
    expect(s.threads.staff.items.at(-1)?.kind).toBe('relay')
    expect(s.threads.research.mouth).toBe('answer')
    expect(
      s.threads.research.items.some(
        (item) => item.kind === 'agent_note' && item.fromId === 'staff' && item.text === 'The operator asked if you are around.',
      ),
    ).toBe(true)
  })

  test('paintSend shows the user bubble and Telling ack without booking jobs', () => {
    const pm = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), pm]
    resetIdsForTests()
    const painted = paintSend(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      'Can you see if Puppetmaster has any open issues or PRs for us?',
    )
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'user' && item.text.includes('Puppetmaster'),
      ),
    ).toBe(true)
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Puppetmaster.',
      ),
    ).toBe(true)
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_pm',
      ),
    ).toBe(true)
    expect(painted.jobs).toHaveLength(0)
    expect(painted.threads.staff.mouth).toBe('idle')
    expect(painted.threads.agent_pm.mouth).toBe('must_first')
    expect(painted.pendingSend?.deliveries).toHaveLength(1)
    expect(painted.pendingSend?.idle).toBe('staff')
    const sisterUsers = painted.threads.agent_pm.items.filter(
      (item) => item.kind === 'msg' && item.from === 'user',
    )
    expect(sisterUsers).toHaveLength(0)
    const flushed = finishSend(painted)
    expect(flushed.jobs).toHaveLength(1)
    expect(flushed.jobs[0]?.ownerAgentId).toBe('agent_pm')
    expect(flushed.pendingSend).toBeUndefined()
    expect(flushed.threads.staff.mouth).toBe('idle')
    expect(flushed.threads.agent_pm.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(
      1,
    )
    expect(finishSend(flushed).threads.agent_pm.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(
      1,
    )
  })

  test('coordinator dispatch paint idles Chief, wakes Marionette, then finishSend books once', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-mn-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_mn',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'hex',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-25T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette]
    resetIdsForTests()
    try {
    const painted = paintSend(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      "What is Marionette's verison up to?",
    )
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'user' && item.text.includes("Marionette's"),
      ),
    ).toBe(true)
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Marionette.',
      ),
    ).toBe(true)
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_mn',
      ),
    ).toBe(true)
    expect(painted.threads.staff.mouth).toBe('idle')
    expect(painted.threads.agent_mn.mouth).toBe('must_first')
    expect(painted.jobs).toHaveLength(0)
    expect(painted.pendingSend?.deliveries).toHaveLength(1)
    expect(painted.pendingSend?.deliveries?.[0]?.agentId).toBe('agent_mn')
    expect(painted.threads.agent_mn.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(
      0,
    )
    const goalsOnPaint = (painted.goals ?? []).filter((goal) => goal.ownerAgentId === 'agent_mn')
    expect(goalsOnPaint).toHaveLength(0)
    const flushed = finishSend(painted)
    expect(flushed.pendingSend).toBeUndefined()
    expect(flushed.jobs).toHaveLength(1)
    expect(flushed.jobs[0]?.ownerAgentId).toBe('agent_mn')
    expect(flushed.threads.agent_mn.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(
      1,
    )
    expect((flushed.goals ?? []).filter((goal) => goal.ownerAgentId === 'agent_mn')).toHaveLength(1)
    const again = finishSend(flushed)
    expect(again.threads.agent_mn.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(1)
    expect((again.goals ?? []).filter((goal) => goal.ownerAgentId === 'agent_mn')).toHaveLength(1)
    expect(again.jobs).toHaveLength(1)
    expect(flushed.threads.agent_mn.mouth).toBe('working')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('paintSend writes overlay user and ack ids onto the presented msgs', () => {
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette]
    resetIdsForTests()
    const overlay = createPendingSendView("What is Marionette's version up to now?", agents, 'staff')
    expect(overlay.userItemId).toBe('item_1')
    expect(overlay.ackItemId).toBe('item_2')
    expect(overlay.ack).toBe('Telling Marionette.')
    const painted = paintSend(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      overlay.text,
      [],
      { userItemId: overlay.userItemId, ackItemId: overlay.ackItemId },
    )
    const user = painted.threads.staff.items.find((item) => item.kind === 'msg' && item.from === 'user')
    const ack = painted.threads.staff.items.find((item) => item.kind === 'msg' && item.from === 'agent')
    expect(user?.id).toBe(overlay.userItemId)
    expect(ack?.id).toBe(overlay.ackItemId)
    expect(ack && ack.kind === 'msg' ? ack.text : '').toBe('Telling Marionette.')
    expect(
      painted.threads.staff.items.some(
        (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_mn',
      ),
    ).toBe(true)
    expect(painted.jobs).toHaveLength(0)
  })

  test('Staff see-if a factory mouth delivers to that thread, not a Staff OpenRouter turn', () => {
    const pm = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), pm]
    resetIdsForTests()
    const s = send(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      'Can you see if Puppetmaster has any open issues or PRs for us?',
    )
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Puppetmaster.',
      ),
    ).toBe(true)
    const ackAt = s.threads.staff.items.findIndex(
      (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Puppetmaster.',
    )
    const sentAt = s.threads.staff.items.findIndex(
      (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_pm',
    )
    expect(ackAt).toBeGreaterThanOrEqual(0)
    expect(sentAt).toBeGreaterThan(ackAt)
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.ownerAgentId).toBe('agent_pm')
    expect(s.jobs[0]?.kind).toBe('analyze')
    expect(s.threads.agent_pm.mouth).toBe('working')
    expect(
      s.threads.agent_pm.items.some(
        (item) => item.kind === 'agent_note' && item.fromId === 'staff',
      ),
    ).toBe(true)
  })

  test('Staff check-each order sends to both mouths without an OpenRouter turn', () => {
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const puppetmaster = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette, puppetmaster]
    resetIdsForTests()
    const s = send(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      'Check Marionette and Puppetmaster each for open PRs or issues, please.',
    )
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some(
        (item) =>
          item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Marionette and Puppetmaster.',
      ),
    ).toBe(true)
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_mn',
      ),
    ).toBe(true)
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'agent_pm',
      ),
    ).toBe(true)
    expect(s.jobs).toHaveLength(2)
    expect(s.jobs.map((job) => job.ownerAgentId).sort()).toEqual(['agent_mn', 'agent_pm'])
    expect(s.jobs.every((job) => job.kind === 'analyze')).toBe(true)
    expect(s.threads.agent_mn.mouth).toBe('working')
    expect(s.threads.agent_pm.mouth).toBe('working')
    expect(s.threads.agent_mn.items.some((item) => item.kind === 'agent_note')).toBe(true)
    expect(s.threads.agent_pm.items.some((item) => item.kind === 'agent_note')).toBe(true)
    expect(s.threads.staff.mouth).not.toBe('answer')
    const ackAt = s.threads.staff.items.findIndex(
      (item) =>
        item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Marionette and Puppetmaster.',
    )
    const sentAt = s.threads.staff.items.findIndex((item) => item.kind === 'relay' && item.lane === 'sent')
    expect(ackAt).toBeGreaterThanOrEqual(0)
    expect(sentAt).toBeGreaterThan(ackAt)
  })

  test('two sister returns wait then one Chief assess of both answers', () => {
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const puppetmaster = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette, puppetmaster]
    resetIdsForTests()
    let s = send(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      'check Puppetmaster and Marionette for prs or open issues',
    )
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.jobs).toHaveLength(2)
    const first = s.jobs.find((job) => job.ownerAgentId === 'agent_pm')
    const second = s.jobs.find((job) => job.ownerAgentId === 'agent_mn')
    expect(first && second).toBeTruthy()
    s = completeJob(s, first!.id, 'Puppetmaster has 2 open PRs.')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(s)).toEqual([])
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text.includes('finished.'),
      ),
    ).toBe(false)
    s = completeJob(s, second!.id, 'Marionette has 1 open issue.')
    expect(s.threads.staff.mouth).toBe('answer')
    const pending = pendingMouthTurns(s)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.agentId).toBe('staff')
    expect(pending[0]?.mode).toBe('assess')
    expect(pending[0]?.userText).toContain('Puppetmaster answered:')
    expect(pending[0]?.userText).toContain('Puppetmaster has 2 open PRs.')
    expect(pending[0]?.userText).toContain('Marionette answered:')
    expect(pending[0]?.userText).toContain('Marionette has 1 open issue.')
    expect(pending[0]?.userText).not.toMatch(/finished\./)
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && /finished\./.test(item.text),
      ),
    ).toBe(false)
  })

  test('What about dugout inherits the prior PR/issue live check', () => {
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const puppetmaster = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const dugout = {
      id: 'agent_dg',
      name: 'Dugout',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette, puppetmaster, dugout]
    resetIdsForTests()
    let s = send(
      {
        agents,
        activeAgentId: 'staff',
        threads: emptyThreads(agents),
        jobs: [],
        pendingFanout: null,
      },
      'check Puppetmaster and Marionette for prs or open issues',
    )
    expect(s.jobs).toHaveLength(2)
    const first = s.jobs.find((job) => job.ownerAgentId === 'agent_pm')
    const second = s.jobs.find((job) => job.ownerAgentId === 'agent_mn')
    expect(first && second).toBeTruthy()
    s = completeJob(s, first!.id, 'Puppetmaster has 2 open PRs.')
    s = completeJob(s, second!.id, 'Marionette has 1 open issue.')
    s = completeMouth(s, 'staff', 'A couple of open PRs between them.')
    s = send(s, 'What about dugout?')
    const follow = s.jobs.filter((job) => job.status === 'running')
    expect(follow.length).toBeGreaterThanOrEqual(1)
    const dugoutJob = follow.find((job) => job.ownerAgentId === 'agent_dg') ?? follow[0]!
    expect(dugoutJob.kind).toBe('analyze')
    const goal = dugoutJob.goal.toLowerCase()
    expect(goal).toContain('dugout')
    expect(goal.includes('pr') || goal.includes('issue') || goal.includes('continuing:')).toBe(true)
    expect(goal).not.toContain('stack')
    expect(goal).not.toContain('fastapi')
    expect(queryFirst('What about dugout?', [
      {
        ownerAgentId: 'agent_dg',
        text: 'Dugout is a FastAPI/SQLModel fantasy baseball app.',
        artifactKind: 'analyze' as const,
        freshness: 'fresh' as const,
      },
    ], 'check Puppetmaster and Marionette for prs or open issues')).toBeNull()
  })

  test('Staff two-name lookup dispatches without a fan-out card', () => {
    const s = send(fresh(), '@Kernel @Research look this up')
    expect(s.pendingFanout).toBeNull()
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Telling Kernel and Research.',
      ),
    ).toBe(true)
    expect(s.threads.kernel.items.length).toBeGreaterThan(0)
    expect(s.threads.research.items.length).toBeGreaterThan(0)
  })

  test('Staff has-Research lookup books an analyze job on Research', () => {
    const s = send(fresh(), 'Have Research look up why Send stays Send in Automaton staff.')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0].ownerAgentId).toBe('research')
    expect(s.jobs[0].kind).toBe('analyze')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.research.mouth).toBe('working')
  })

  test('Research ping return beat lands on Staff without a job id', () => {
    let s = send(fresh(), 'Can you ask research if he is online?')
    s = completeMouth(s, 'research', 'Yes, I am here.')
    expect(s.threads.research.mouth).toBe('idle')
    const from = s.threads.staff.items.find((item) => item.kind === 'relay' && item.lane === 'from')
    expect(from?.kind === 'relay' && from.peerId === 'research' && from.text === 'Yes, I am here.').toBe(true)
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.items.at(-1)?.kind).toBe('relay')
    const pending = pendingMouthTurns(s)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.agentId).toBe('staff')
    expect(pending[0]?.mode).toBe('assess')
    expect(pending[0]?.userText).toContain('Research answered:')
    s = completeMouth(
      s,
      'staff',
      'Research is online. What would you like the research automaton to run?',
    )
    const staffLast = s.threads.staff.items.at(-1)
    expect(staffLast?.kind).toBe('msg')
    if (staffLast?.kind === 'msg') {
      expect(staffLast.from).toBe('agent')
      expect(staffLast.text).toBe('Research is online. What would you like the research automaton to run?')
      expect(staffLast.text).not.toBe('Yes, I am here.')
      expect(staffLast.text).not.toMatch(/job_/)
    }
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some((item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'research'),
    ).toBe(true)
  })

  test('Staff-dispatched Research job returns a short beat on Staff', () => {
    let s = send(fresh(), 'Have Research look up why Send stays Send in Automaton staff.')
    const jobId = s.jobs[0].id
    s = completeJob(s, jobId, 'Send stays Send while a job flies.')
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.items.at(-1)?.kind).toBe('relay')
    expect(
      s.threads.staff.items.some(
        (item) =>
          item.kind === 'relay' &&
          item.lane === 'from' &&
          item.peerId === 'research' &&
          item.text === 'Send stays Send while a job flies.',
      ),
    ).toBe(true)
    s = completeMouth(s, 'staff', 'Research found that Send stays Send. Ask them to check the composer next.')
    const staffLast = s.threads.staff.items.at(-1)
    expect(staffLast?.kind).toBe('msg')
    if (staffLast?.kind === 'msg') {
      expect(staffLast.from).toBe('agent')
      expect(staffLast.text).toBe('Research found that Send stays Send. Ask them to check the composer next.')
      expect(staffLast.text).not.toBe('Send stays Send while a job flies.')
    }
  })

  test('Staff assess fail falls back without parroting the sister', () => {
    let s = send(fresh(), 'Can you ping research?')
    s = completeMouth(s, 'research', "I'm here to assist you. How can I help?")
    s = failMouth(s, 'staff', 'Need an OpenRouter key.')
    const staffLast = s.threads.staff.items.at(-1)
    expect(staffLast?.kind).toBe('msg')
    if (staffLast?.kind === 'msg') {
      expect(staffLast.text).toBe('Research is on the rail.')
      expect(staffLast.text).not.toBe("I'm here to assist you. How can I help?")
      expect(staffLast.text).not.toBe('Need an OpenRouter key.')
    }
  })

  test('Staff create-automaton line acks and does not steal focus', () => {
    const s = send(fresh(), 'Create an automaton for Marionette and one for Puppetmaster')
    expect(s.activeAgentId).toBe('staff')
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.staff.mouth).toBe('idle')
    const staffLast = s.threads.staff.items.at(-1)
    expect(staffLast?.kind).toBe('msg')
    if (staffLast?.kind === 'msg') {
      expect(staffLast.text).toBe('Created Marionette and Puppetmaster.')
    }
  })

  test('Staff bind homes pings the product mouths and skips jobs', () => {
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const puppetmaster = {
      id: 'agent_p',
      name: 'Puppetmaster',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    let s = addLiveAgent(fresh(), marionette, false)
    s = addLiveAgent(s, puppetmaster, false)
    s = send(
      s,
      'Associate Puppetmaster and Marionette with https://github.com/example/Puppetmaster and https://github.com/example/marionette/',
    )
    expect(s.activeAgentId).toBe('staff')
    expect(s.jobs).toHaveLength(0)
    expect(
      s.threads.staff.items.some(
        (item) =>
          item.kind === 'msg' &&
          item.from === 'agent' &&
          item.text ===
            "Bound. Puppetmaster's home is example/Puppetmaster. Marionette's is example/marionette.",
      ),
    ).toBe(true)
    expect(s.threads.agent_p.mouth).toBe('answer')
    expect(s.threads.agent_m.mouth).toBe('answer')
    expect(
      s.threads.agent_p.items.some(
        (item) =>
          item.kind === 'agent_note' &&
          item.text === 'Your home is example/Puppetmaster. Work for this product goes there, not Automaton.',
      ),
    ).toBe(true)
  })

  test('Staff rename line acks and keeps focus', () => {
    const bot = {
      id: 'agent_9',
      name: 'New Bot',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    let s = addLiveAgent(fresh(), bot, false)
    s = send(s, 'rename New Bot to Puppetmaster')
    expect(s.activeAgentId).toBe('staff')
    expect(s.agents.find((agent) => agent.id === 'agent_9')?.name).toBe('Puppetmaster')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Renamed. New Bot is now Puppetmaster.',
      ),
    ).toBe(true)
    s = addLiveAgent(fresh(), bot, false)
    s = send(s, "Rename the 'New Bot' to Puppetmaster please.")
    expect(s.agents.find((agent) => agent.id === 'agent_9')?.name).toBe('Puppetmaster')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Renamed. New Bot is now Puppetmaster.',
      ),
    ).toBe(true)
  })

  test('Staff github-login ask opens the desk URL and does not mouth-navigate', () => {
    const s = send(fresh(), 'Can you navigate to the github on your pc so I can login?')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(s)).toEqual([])
    expect(s.jobs).toHaveLength(0)
    expect(s.deskOpen).toEqual({ agentId: 'staff', url: 'https://github.com/login' })
    expect(
      s.threads.staff.items.some(
        (item) =>
          item.kind === 'msg' &&
          item.from === 'agent' &&
          item.text === 'Opening github.com.',
      ),
    ).toBe(true)
    expect(s.deskHandoff).toEqual({
      agentId: 'staff',
      url: 'https://github.com/login',
      instruction: 'Sign in to GitHub.',
    })
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && /Take control to sign in/i.test(item.text),
      ),
    ).toBe(false)
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && /navigated/i.test(item.text),
      ),
    ).toBe(false)
  })

  test('Staff google ask opens the desk and does not lecture about the runtime', () => {
    const s = send(fresh(), 'can you navigate to Google on your machine')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(s)).toEqual([])
    expect(s.jobs).toHaveLength(0)
    expect(s.deskOpen).toEqual({ agentId: 'staff', url: 'https://www.google.com/' })
    expect(
      s.threads.staff.items.some(
        (item) =>
          item.kind === 'msg' &&
          item.from === 'agent' &&
          item.text === 'Opening www.google.com.',
      ),
    ).toBe(true)
    expect(s.deskHandoff?.instruction).toBe('Sign in to your Google account.')
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && /runtime action|display profile/i.test(item.text),
      ),
    ).toBe(false)
  })

  test('status ask while the owner job runs stays working and skips a mouth turn', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.threads.kernel.mouth).toBe('working')
    const jobId = s.jobs[0]?.id
    expect(jobId).toBeTruthy()
    s = send(s, 'how did it go?')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.status).toBe('running')
    expect(s.threads.kernel.mouth).toBe('working')
    expect(pendingMouthTurns(s)).toEqual([])
    const last = s.threads.kernel.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') {
      expect(last.from).toBe('agent')
      expect(last.text).toBe('Still running.')
      expect(last.text).not.toBe('Done.')
    }
    s = send(s, 'what did you find')
    expect(s.threads.kernel.mouth).toBe('working')
    expect(pendingMouthTurns(s)).toEqual([])
    expect(s.jobs[0]?.status).toBe('running')
    s = completeJob(s, s.jobs[0].id, 'The ledger replay is deterministic.')
    s = send(s, 'how did it go?')
    expect(s.threads.kernel.mouth).toBe('answer')
    expect(pendingMouthTurns(s)).toHaveLength(1)
    expect(pendingMouthTurns(s)[0]?.userText).toBe('how did it go?')
  })

  test('noteJobStatus speaks once, then only refreshes the handle', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    const jobId = s.jobs[0].id
    s = noteJobStatus(s, jobId, 'Still running.')
    expect(s.jobs[0]?.lastNote).toBe('Still running.')
    expect(typeof s.jobs[0]?.updatedAt).toBe('number')
    expect(s.threads.kernel.mouth).toBe('working')
    const spoken = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'agent')
    expect(spoken.some((item) => item.kind === 'msg' && item.text === 'Still running.')).toBe(true)
    const afterFirst = spoken.length
    s = noteJobStatus(s, jobId, 'Still running.')
    const spokenAgain = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'agent')
    expect(spokenAgain).toHaveLength(afterFirst)
    expect(s.jobs[0]?.status).toBe('running')
    s = noteJobStatus(s, jobId, 'Done.')
    expect(s.jobs[0]?.lastNote).toBe('Still running.')
    expect(s.jobs[0]?.status).toBe('running')
    s = completeJob(s, jobId, 'The ledger replay is deterministic.')
    expect(s.jobs[0]?.status).toBe('complete')
    const last = s.threads.kernel.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') {
      expect(last.text).toBe('The ledger replay is deterministic.')
    }
    expect(s.threads.kernel.mouth).toBe('idle')
  })

  test('PATH and apt asks book a box-shell job, not implement on the Mac', () => {
    const pathAsk = send(fresh(), 'is claude on PATH')
    expect(pathAsk.jobs).toHaveLength(1)
    expect(pathAsk.jobs[0]?.kind).toBe('box-shell')
    expect(pathAsk.jobs[0]?.ownerAgentId).toBe('staff')
    expect(pathAsk.threads.staff.mouth).toBe('working')
    const install = send(fresh(), 'install curl on the computer')
    expect(install.jobs[0]?.kind).toBe('box-shell')
  })

  test('install then PATH check books the leftover box-shell without a new send', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.kind).toBe('box-shell')
    expect(s.jobs[0]?.goal.toLowerCase()).toContain('curl')
    expect(s.jobs[0]?.goal.toLowerCase()).not.toContain('python')
    expect(s.goals).toHaveLength(1)
    expect(s.goals?.[0]?.coordinatorId).toBe('staff')
    expect(s.goals?.[0]?.criteria.map((row) => row.kind)).toEqual(['box-shell', 'box-shell'])
    const firstId = s.jobs[0].id
    s = completeJob(s, firstId, 'curl is installed.')
    expect(s.jobs).toHaveLength(2)
    expect(s.jobs[1]?.kind).toBe('box-shell')
    expect(s.jobs[1]?.status).toBe('running')
    expect(s.jobs[1]?.goal.toLowerCase()).toContain('python')
    expect(s.threads.staff.mouth).toBe('working')
    expect(pendingMouthTurns(s)).toEqual([])
    const last = s.threads.staff.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') expect(last.text).toBe('curl is installed.')
    s = completeJob(s, s.jobs[1].id, 'python is on PATH.')
    expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(0)
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.goals?.[0]?.status).toBe('complete')
  })

  test('repeating a finished two-step GoalRun still books the second criterion', () => {
    const ask = 'install curl on the computer then check if python is on PATH'
    let s = send(fresh(), ask)
    s = completeJob(s, s.jobs[0].id, 'curl is installed.')
    s = completeJob(s, s.jobs[1].id, 'python is on PATH.')
    expect(s.goals?.[0]?.status).toBe('complete')
    const firstGoalId = s.goals?.[0]?.id
    s = send(s, ask)
    expect(s.goals).toHaveLength(2)
    expect(s.goals?.[1]?.id).not.toBe(firstGoalId)
    expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(1)
    s = completeJob(s, s.jobs[2].id, 'curl is installed.')
    expect(s.jobs).toHaveLength(4)
    expect(s.jobs[3]?.kind).toBe('box-shell')
    expect(s.jobs[3]?.status).toBe('running')
    expect(s.jobs[3]?.goal.toLowerCase()).toContain('python')
    expect(s.goals?.[1]?.status).toBe('running')
    expect(s.goals?.[1]?.criteria[1]?.status).toBe('running')
    expect(s.goals?.[1]?.criteria.some((row) => row.status === 'skipped')).toBe(false)
  })

  test('analyze then implement leftover books implement on the same owner', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'look at marionette then implement the router patch in that checkout')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.kind).toBe('analyze')
    s = completeJob(s, s.jobs[0].id, 'Routing lives in the marionette bridge.')
    expect(s.jobs).toHaveLength(2)
    expect(s.jobs[1]?.kind).toBe('implement')
    expect(s.jobs[1]?.ownerAgentId).toBe('kernel')
    expect(s.threads.kernel.mouth).toBe('working')
    s = completeJob(s, s.jobs[1].id, 'The patch landed.')
    expect(s.threads.kernel.mouth).toBe('idle')
    expect(s.goals?.[0]?.status).toBe('complete')
  })

  test('Staff assess waits until the sister GoalRun is closed', () => {
    let s = send(fresh(), 'Ask Kernel to install curl on the computer then check if python is on PATH')
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.ownerAgentId).toBe('kernel')
    expect(s.threads.staff.mouth).toBe('idle')
    s = completeJob(s, s.jobs[0].id, 'curl is installed.')
    expect(s.jobs).toHaveLength(2)
    expect(s.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(s)).toEqual([])
    s = completeJob(s, s.jobs[1].id, 'python is on PATH.')
    expect(s.threads.kernel.mouth).toBe('idle')
    expect(s.threads.staff.mouth).toBe('answer')
    const pending = pendingMouthTurns(s)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.agentId).toBe('staff')
    expect(pending[0]?.mode).toBe('assess')
    expect(pending[0]?.userText).toContain('Do not ask permission')
  })

  test('Stop cancels the GoalRun and does not book leftover', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    s = stopJob(s, s.jobs[0].id)
    expect(s.jobs[0]?.status).toBe('failed')
    expect(s.jobs).toHaveLength(1)
    expect(s.goals?.[0]?.status).toBe('cancelled')
    expect(s.threads.staff.mouth).toBe('idle')
  })

  test('failed first step does not book leftover', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    s = failJob(s, s.jobs[0].id, "Didn't land.")
    expect(s.jobs).toHaveLength(1)
    expect(s.jobs[0]?.status).toBe('failed')
    expect(s.goals?.[0]?.status).toBe('failed')
    expect(s.threads.staff.mouth).toBe('idle')
  })

  test('Staff issue drop binds then books absorb with leftover land and ship', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-issue-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'blob',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-26T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    const ask =
      'Here is a new issue for Marionette, take it to the finish line, absorb it where relevant/validate it, merge it from dest to main so the branches are equal, and ship it when done, new release. https://github.com/professorpalmer/marionette/issues/223'
    try {
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        ask,
      )
      expect(s.jobs).toHaveLength(1)
      expect(s.jobs[0]?.ownerAgentId).toBe('agent_m')
      expect(s.jobs[0]?.kind).toBe('implement')
      expect(s.jobs[0]?.goal).toContain('issues/223')
      expect(s.threads.agent_m.mouth).toBe('working')
      expect(s.threads.staff.mouth).toBe('idle')
      expect(s.goals).toHaveLength(1)
      expect(s.goals?.[0]?.coordinatorId).toBe('staff')
      expect(s.goals?.[0]?.ownerAgentId).toBe('agent_m')
      expect(s.goals?.[0]?.criteria.map((row) => row.kind)).toEqual(['implement', 'promote', 'ship'])
      expect(s.threads.agent_m).not.toHaveProperty('mandate')
      expect(
        s.threads.staff.items.some(
          (item) =>
            item.kind === 'msg' &&
            item.from === 'agent' &&
            item.text.includes("Marionette's home is professorpalmer/marionette") &&
            item.text.includes('Telling Marionette'),
        ),
      ).toBe(true)
      expect(pendingMouthTurns(s)).toEqual([])
      const firstId = s.jobs[0].id
      s = completeJob(s, firstId, 'Scope labels now match the data they aggregate.')
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      expect(openWidget(s)?.purpose).toBe('merge')
      s = confirmLand(s, 'merge')
      expect(s.jobs[1]?.kind).toBe('promote')
      expect(s.jobs[1]?.goal).toBe('merge dest to main')
      expect(s.threads.agent_m.mouth).toBe('working')
      s = completeJob(s, s.jobs[1].id, 'dev and main are equal.')
      expect(s.jobs.some((job) => job.kind === 'ship' && job.status === 'running')).toBe(false)
      expect(openWidget(s)?.purpose).toBe('ship')
      s = confirmLand(s, 'ship')
      expect(s.jobs[2]?.kind).toBe('ship')
      expect(s.jobs[2]?.goal).toBe('ship a new release')
      s = completeJob(s, s.jobs[2].id, 'Shipped v0.9.360.')
      expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(0)
      expect(s.goals?.[0]?.status).toBe('complete')
      expect(s.threads.agent_m.mouth).toBe('idle')
      expect(s.threads.staff.mouth).toBe('answer')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('exact PR sentence creates a Staff GoalRun and books analyze on Marionette', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-pr-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'blob',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-26T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    const ask =
      'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?'
    try {
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        ask,
      )
      expect(s.jobs).toHaveLength(1)
      expect(s.jobs[0]?.kind).toBe('analyze')
      expect(s.jobs[0]?.ownerAgentId).toBe('agent_m')
      expect(s.jobs[0]?.goalId).toBe(s.goals?.[0]?.id)
      expect(s.goals).toHaveLength(1)
      expect(s.goals?.[0]?.coordinatorId).toBe('staff')
      expect(s.goals?.[0]?.ownerAgentId).toBe('agent_m')
      expect(s.goals?.[0]?.criteria.map((row) => row.kind)).toEqual([
        'analyze',
        'implement',
        'promote',
        'ship',
      ])
      expect(s.threads.agent_m).not.toHaveProperty('mandate')
      expect(s.threads.staff.mouth).toBe('idle')
      expect(pendingMouthTurns(s)).toEqual([])
      s = completeJob(s, s.jobs[0].id, 'dest checks are green.')
      expect(s.jobs).toHaveLength(2)
      expect(s.jobs[1]?.kind).toBe('implement')
      expect(s.jobs[1]?.evidence?.some((row) => row.includes('green'))).toBe(true)
      expect(s.threads.staff.mouth).toBe('idle')
      s = completeJob(s, s.jobs[1].id, 'Scope labels now match the data they aggregate.')
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      expect(openWidget(s)?.purpose).toBe('merge')
      expect(s.threads.staff.mouth).toBe('idle')
      s = confirmLand(s, 'merge')
      expect(s.jobs[2]?.kind).toBe('promote')
      expect(s.threads.staff.mouth).toBe('idle')
      s = completeJob(s, s.jobs[2].id, 'dev and main are equal.')
      expect(openWidget(s)?.purpose).toBe('ship')
      s = confirmLand(s, 'ship')
      expect(s.jobs[3]?.kind).toBe('ship')
      s = completeJob(s, s.jobs[3].id, 'Shipped v0.9.360.')
      expect(s.goals?.[0]?.status).toBe('complete')
      expect(s.threads.staff.mouth).toBe('answer')
      expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('failed absorb does not book merge and Staff speaks one blocker', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-fail-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'blob',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-26T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    const ask =
      'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?'
    try {
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        ask,
      )
      s = completeJob(s, s.jobs[0].id, 'two checks red on dest.')
      expect(s.jobs[1]?.kind).toBe('implement')
      s = failJob(s, s.jobs[1].id, "Didn't land.")
      expect(s.jobs).toHaveLength(2)
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      expect(s.threads.staff.items.some((item) => item.kind === 'widget')).toBe(false)
      expect(s.goals?.[0]?.status).toBe('failed')
      expect(s.threads.staff.mouth).toBe('idle')
      expect(
        s.threads.staff.items.some(
          (item) =>
            item.kind === 'msg' &&
            item.from === 'agent' &&
            item.text.includes('blocked') &&
            item.text.includes("Didn't land."),
        ),
      ).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('waiting_external promote then complete books ship without a Staff blocker', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-wait-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'blob',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-26T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    const ask =
      'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?'
    try {
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        ask,
      )
      s = completeJob(s, s.jobs[0].id, 'dest checks are green.')
      s = completeJob(s, s.jobs[1].id, 'Scope labels now match the data they aggregate.')
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      s = confirmLand(s, 'merge')
      expect(s.jobs[2]?.kind).toBe('promote')
      const staffBefore = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')
      s = waitJobExternal(s, s.jobs[2].id)
      expect(s.goals?.[0]?.status).toBe('waiting_external')
      expect(s.jobs[2]?.status).toBe('running')
      expect(s.jobs.some((row) => row.kind === 'ship')).toBe(false)
      expect(s.threads.staff.mouth).toBe('idle')
      expect(
        s.threads.staff.items.some(
          (item) => item.kind === 'msg' && item.from === 'agent' && /blocked|\?/.test(item.text),
        ),
      ).toBe(false)
      expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')).toHaveLength(
        staffBefore.length,
      )
      const failed = failJob(s, s.jobs[2].id, "Couldn't merge dest into main.")
      expect(failed.goals?.[0]?.status).toBe('failed')
      s = completeJob(s, s.jobs[2].id, 'dev and main are equal.')
      expect(s.goals?.[0]?.status).toBe('waiting_user')
      expect(openWidget(s)?.purpose).toBe('ship')
      s = confirmLand(s, 'ship')
      expect(s.jobs[3]?.kind).toBe('ship')
      s = completeJob(s, s.jobs[3].id, 'Shipped v0.9.360.')
      expect(s.goals?.[0]?.status).toBe('complete')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('tag and shipping prose do not book a ship job', () => {
    let tag = setActive(fresh(), 'kernel')
    tag = send(tag, 'look at the tag in package.json')
    expect(tag.jobs.some((job) => job.kind === 'ship')).toBe(false)
    let shipping = setActive(fresh(), 'kernel')
    shipping = send(shipping, 'the feature is shipping next week')
    expect(shipping.jobs.some((job) => job.kind === 'ship')).toBe(false)
    expect(shipping.jobs).toHaveLength(0)
  })

  test('a pull URL plus ship a new release books implement, promote, then ship', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-session-ship-url-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        rules: '',
        kit: 'code',
        avatarShape: 'blob',
        avatarColor: 'kernel',
        namedBy: 'user',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '2026-08-26T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
      },
      home,
    )
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    resetIdsForTests()
    try {
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        'https://github.com/professorpalmer/marionette/pull/12 ship a new release',
      )
      expect(s.goals?.[0]?.criteria.map((row) => row.kind)).toEqual(['implement', 'promote', 'ship'])
      expect(s.jobs[0]?.kind).toBe('implement')
      s = completeJob(s, s.jobs[0].id, 'Scope labels now match the data they aggregate.')
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      s = confirmLand(s, 'merge')
      expect(s.jobs[1]?.kind).toBe('promote')
      s = completeJob(s, s.jobs[1].id, 'dev and main are equal.')
      s = confirmLand(s, 'ship')
      expect(s.jobs[2]?.kind).toBe('ship')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('dispatchableJobs serializes host land per owner and leaves other work flying', () => {
    const s: Session = {
      ...fresh(),
      jobs: [
        {
          id: 'job_host_a',
          ownerAgentId: 'kernel',
          goal: 'merge dest to main',
          status: 'running',
          kind: 'promote',
        },
        {
          id: 'job_host_b',
          ownerAgentId: 'kernel',
          goal: 'ship a new release',
          status: 'running',
          kind: 'ship',
        },
        {
          id: 'job_look',
          ownerAgentId: 'kernel',
          goal: 'look up the ledger',
          status: 'running',
          kind: 'analyze',
        },
        {
          id: 'job_impl',
          ownerAgentId: 'research',
          goal: 'absorb the patch',
          status: 'running',
          kind: 'implement',
        },
        {
          id: 'job_host_c',
          ownerAgentId: 'agent_m',
          goal: 'merge dest to main',
          status: 'running',
          kind: 'promote',
        },
      ],
    }
    expect(runningJobs(s).map((job) => job.id)).toEqual([
      'job_host_a',
      'job_host_b',
      'job_look',
      'job_impl',
      'job_host_c',
    ])
    expect(dispatchableJobs(s).map((job) => job.id)).toEqual([
      'job_host_a',
      'job_look',
      'job_impl',
      'job_host_c',
    ])
    const after = {
      ...s,
      jobs: s.jobs.map((job) =>
        job.id === 'job_host_a' ? { ...job, status: 'complete' as const } : job,
      ),
    }
    expect(runningJobs(after).map((job) => job.id)).toEqual([
      'job_host_b',
      'job_look',
      'job_impl',
      'job_host_c',
    ])
    expect(dispatchableJobs(after).map((job) => job.id)).toEqual([
      'job_host_b',
      'job_look',
      'job_impl',
      'job_host_c',
    ])
  })

  test('concurrent GoalRuns do not replace each other', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    expect(s.goals).toHaveLength(1)
    const firstId = s.goals?.[0]?.id
    s = send(s, 'is claude on PATH')
    expect(s.goals).toHaveLength(2)
    expect(s.goals?.map((row) => row.id)).toContain(firstId)
    expect(s.goals?.[1]?.id).not.toBe(firstId)
    expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(2)
  })

  test('jobs without goalId complete without advancing a GoalRun after reload', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    const firstId = s.goals?.[0]?.id
    const attachedId = s.jobs[0]?.id
    expect(firstId).toBeTruthy()
    expect(attachedId).toBeTruthy()
    s = send(s, 'is claude on PATH')
    const secondId = s.goals?.[1]?.id
    expect(secondId).toBeTruthy()
    s = {
      ...s,
      jobs: [
        ...s.jobs,
        {
          id: 'job_orphan',
          ownerAgentId: 'staff',
          goal: 'install curl on the computer',
          status: 'running',
          kind: 'box-shell',
        },
      ],
    }
    const path = join(tmpdir(), `automaton-session-orphan-${Date.now()}.sqlite`)
    openStaffStore(path).save(s)
    const loaded = openStaffStore(path).load()
    expect(loaded).toBeTruthy()
    s = loaded!
    expect(s.jobs.find((job) => job.id === 'job_orphan')?.goalId).toBeUndefined()
    s = completeJob(s, 'job_orphan', 'curl is installed.')
    expect(s.jobs.find((job) => job.id === 'job_orphan')?.status).toBe('complete')
    expect(s.goals?.find((row) => row.id === firstId)?.status).toBe('running')
    expect(s.goals?.find((row) => row.id === firstId)?.criteria[0]?.status).toBe('running')
    expect(s.goals?.find((row) => row.id === firstId)?.receipts).toEqual([])
    expect(s.goals?.find((row) => row.id === secondId)?.status).toBe('running')
    expect(s.goals?.find((row) => row.id === secondId)?.criteria[0]?.status).toBe('running')
    expect(s.jobs.filter((job) => job.status === 'running')).toHaveLength(2)
    s = completeJob(s, attachedId!, 'curl is installed.')
    expect(s.goals?.find((row) => row.id === firstId)?.criteria[0]?.status).toBe('met')
    expect(s.jobs.some((job) => job.goalId === firstId && job.goal.toLowerCase().includes('python'))).toBe(true)
    expect(s.goals?.find((row) => row.id === secondId)?.criteria[0]?.status).toBe('running')
    expect(s.jobs.some((job) => job.goalId === secondId && job.status === 'running')).toBe(true)
  })

  test('waiting_user parks the job, retry books a fresh job, cancel settles without dispatch', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    const firstId = s.jobs[0]?.id
    const goalId = s.goals?.[0]?.id
    const criterionId = s.goals?.[0]?.criteria[0]?.id
    expect(firstId && goalId && criterionId).toBeTruthy()
    const staffBefore = s.threads.staff.items.filter((item) => item.kind === 'msg')
    s = waitJobUser(s, firstId!, 'Need a product checkout to land dest.')
    expect(s.jobs[0]?.status).toBe('waiting')
    expect(s.jobs).toHaveLength(1)
    expect(s.goals?.[0]?.status).toBe('waiting_user')
    expect(s.goals?.[0]?.criteria[0]?.status).toBe('blocked')
    expect(s.goals?.[0]?.blocker?.reason).toContain('Need a product checkout')
    expect(s.goals?.[0]?.blocker?.criterionId).toBe(criterionId)
    expect(s.goals?.[0]?.blocker?.source).toBe('staff')
    expect(runningJobs(s)).toEqual([])
    expect(dispatchableJobs(s)).toEqual([])
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg')).toHaveLength(staffBefore.length)
    expect(
      s.threads.staff.items.some(
        (item) => item.kind === 'msg' && item.from === 'agent' && /blocked|\?/.test(item.text),
      ),
    ).toBe(false)

    const retried = retryGoal(s, goalId!)
    expect(retried.goals?.[0]?.status).toBe('running')
    expect(retried.goals?.[0]?.blocker).toBeUndefined()
    expect(retried.goals?.[0]?.criteria[0]?.status).toBe('running')
    expect(retried.jobs).toHaveLength(2)
    expect(retried.jobs[0]?.status).toBe('failed')
    expect(retried.jobs.some((row) => row.status === 'waiting')).toBe(false)
    expect(retried.jobs[1]?.id).not.toBe(firstId)
    expect(retried.jobs[1]?.status).toBe('running')
    expect(retried.jobs[1]?.criterionId).toBe(criterionId)
    expect(retried.jobs[1]?.goalId).toBe(goalId)
    expect(dispatchableJobs(retried).map((job) => job.id)).toEqual([retried.jobs[1]!.id])
    expect(retried.jobs.some((job) => job.goal.toLowerCase().includes('python'))).toBe(false)

    const cancelled = cancelGoal(s, goalId!)
    expect(cancelled.goals?.[0]?.status).toBe('cancelled')
    expect(cancelled.goals?.[0]?.blocker).toBeUndefined()
    expect(cancelled.jobs[0]?.status).toBe('failed')
    expect(cancelled.jobs).toHaveLength(1)
    expect(dispatchableJobs(cancelled)).toEqual([])
    expect(cancelled.jobs.some((job) => job.goal.toLowerCase().includes('python'))).toBe(false)
  })

  test('waitJobUser rejects complete or cancelled goals before parking the job', () => {
    let s = send(fresh(), 'install curl on the computer')
    const jobId = s.jobs[0]?.id
    expect(jobId).toBeTruthy()
    const complete = {
      ...s,
      goals: s.goals?.map((goal) => ({ ...goal, status: 'complete' as const })),
    }
    const afterComplete = waitJobUser(complete, jobId!, 'Need an OpenRouter key.', 'staff')
    expect(afterComplete.jobs[0]?.status).toBe('running')
    expect(afterComplete.goals?.[0]?.status).toBe('complete')
    expect(afterComplete.goals?.[0]?.blocker).toBeUndefined()

    const cancelled = {
      ...s,
      goals: s.goals?.map((goal) => ({ ...goal, status: 'cancelled' as const })),
    }
    const afterCancel = waitJobUser(cancelled, jobId!, 'Need an OpenRouter key.', 'staff')
    expect(afterCancel.jobs[0]?.status).toBe('running')
    expect(afterCancel.goals?.[0]?.status).toBe('cancelled')
    expect(afterCancel.goals?.[0]?.blocker).toBeUndefined()
  })

  test('missing OpenRouter key parks the GoalRun without speaking', () => {
    let s = send(fresh(), 'install curl on the computer')
    const staffBefore = s.threads.staff.items.filter((item) => item.kind === 'msg')
    s = waitJobUser(s, s.jobs[0]!.id, 'Need an OpenRouter key.', 'staff')
    expect(s.jobs[0]?.status).toBe('waiting')
    expect(s.goals?.[0]?.status).toBe('waiting_user')
    expect(s.goals?.[0]?.blocker?.reason).toBe('Need an OpenRouter key.')
    expect(s.goals?.[0]?.blocker?.source).toBe('staff')
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg')).toHaveLength(staffBefore.length)
    expect(s.threads.staff.mouth).toBe('idle')
  })
})

describe('first-open greeting', () => {
  test('maybeIntro fires once, sticks after complete, and Send stays Send', () => {
    let s = maybeIntro(fresh(), 'staff', null)
    expect(s.threads.staff.mouth).toBe('intro')
    expect(isMouthBusy('intro')).toBe(true)
    expect(composerEnterBusy('intro')).toBe(false)
    expect(pendingMouthTurns(s)[0]?.mode).toBe('intro')
    expect(pendingMouthTurns(s)[0]?.agentId).toBe('staff')
    s = completeMouth(s, 'staff', 'Chief of Staff. I coordinate this computer.')
    expect(s.threads.staff.mouth).toBe('idle')
    const greetings = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')
    expect(greetings).toHaveLength(1)
    if (greetings[0]?.kind === 'msg') {
      expect(greetings[0].text).toContain('Chief of Staff')
    }
    const replay = maybeIntro(s, 'staff', '2026-08-27T06:00:00.000Z')
    expect(replay.threads.staff.items).toHaveLength(1)
    expect(replay.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(replay)).toEqual([])
  })

  test('setActive and focused factory create start intro; unfocused create waits', () => {
    let s = setActive(fresh(), 'staff', null)
    expect(s.threads.staff.mouth).toBe('intro')
    s = completeMouth(s, 'staff', 'Chief of Staff. Coordinator.')
    const bot = {
      id: 'agent_1',
      name: 'New automaton',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    s = addLiveAgent(s, bot, false, null)
    expect(s.activeAgentId).toBe('staff')
    expect(s.threads.agent_1.mouth).toBe('idle')
    expect(s.threads.agent_1.items).toHaveLength(0)
    s = addLiveAgent(s, { ...bot, id: 'agent_2', name: 'Scout' }, true, null)
    expect(s.activeAgentId).toBe('agent_2')
    expect(s.threads.agent_2.mouth).toBe('intro')
    expect(s.threads.agent_2.unread).toBe(0)
    s = completeMouth(s, 'agent_2', 'Scout.')
    expect(s.threads.agent_2.unread).toBe(0)
    s = setActive(s, 'agent_1', null)
    expect(s.threads.agent_1.mouth).toBe('intro')
  })

  test('user send first skips intro forever even if the transcript is later empty', () => {
    let s = send(fresh(), 'hello staff')
    expect(hasUserMessage(s, 'staff')).toBe(true)
    expect(s.threads.staff.mouth).toBe('answer')
    s = maybeIntro(s, 'staff', null)
    expect(s.threads.staff.mouth).toBe('answer')
    s = completeMouth(s, 'staff', 'Hello.')
    s = setThreadEmpty(s, 'staff')
    s = maybeIntro(s, 'staff', '2026-08-27T06:00:00.000Z')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.staff.items).toHaveLength(0)
  })

  test('user send during intro wins and does not leave a second greeting', () => {
    let s = maybeIntro(fresh(), 'staff', null)
    expect(s.threads.staff.mouth).toBe('intro')
    s = send(s, 'skip the hello')
    expect(s.threads.staff.mouth).toBe('answer')
    s = completeMouth(s, 'staff', 'should not land as intro')
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')).toHaveLength(1)
    const after = completeMouth(s, 'staff', 'Chief of Staff. Coordinator.')
    expect(after).toBe(s)
  })

  test('click away and back does not start a second intro once played', () => {
    let s = maybeIntro(fresh(), 'staff', null)
    s = completeMouth(s, 'staff', 'Chief of Staff. Coordinator.')
    s = setActive(s, 'kernel')
    s = setActive(s, 'staff', '2026-08-27T06:00:00.000Z')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'agent')).toHaveLength(1)
  })

  test('remount idles an in-flight intro without speaking', () => {
    let s = maybeIntro(fresh(), 'staff', null)
    s = idleOrphanMouths(s)
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.staff.items).toHaveLength(0)
  })
})


describe('steer-queue', () => {
  test('Send stays Send during a live mouth turn', () => {
    const s = send(fresh(), 'hello staff')
    expect(s.threads.staff.mouth).toBe('answer')
    expect(composerEnterBusy(s.threads.staff.mouth)).toBe(false)
    expect(shouldQueueSteer(s.threads.staff.mouth)).toBe(true)
    expect(isMouthBusy(s.threads.staff.mouth)).toBe(true)
  })

  test('composer-stop idles mouth and leaves the steer queue parked', () => {
    let s = send(fresh(), 'hello staff')
    expect(s.threads.staff.mouth).toBe('answer')
    expect(pendingMouthTurns(s)).toHaveLength(1)
    s = send(s, 'also check the pin')
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'also check the pin' }])
    s = stopMouth(s, 'staff')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(pendingMouthTurns(s)).toEqual([])
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'also check the pin' }])
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(1)
    if (users[0]?.kind === 'msg') expect(users[0].text).toBe('hello staff')
    expect(shouldQueueSteer(s.threads.staff.mouth)).toBe(false)
  })

  test('mid-turn Send parks off the transcript until drain', () => {
    let s = send(fresh(), 'hello staff')
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(1)
    s = send(s, 'also check the pin')
    expect(s.threads.staff.mouth).toBe('answer')
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(1)
    if (users[0]?.kind === 'msg') expect(users[0].text).toBe('hello staff')
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'also check the pin' }])
    expect(s.threads.staff.draft).toBe('')
    s = completeMouth(s, 'staff', 'The pin is grok-4.6 Extra High plus Fast.')
    const after = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(after).toHaveLength(2)
    if (after[1]?.kind === 'msg') expect(after[1].text).toBe('also check the pin')
    expect(s.threads.staff.steerQueue).toEqual([])
    expect(s.threads.staff.mouth).toBe('working')
    expect(s.jobs[0]?.kind).toBe('analyze')
  })

  test('failMouth also drains the parked line', () => {
    let s = send(fresh(), 'hello staff')
    s = send(s, 'try again')
    s = failMouth(s, 'staff', "Couldn't reach OpenRouter.")
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(2)
    if (users[1]?.kind === 'msg') expect(users[1].text).toBe('try again')
    expect(s.threads.staff.steerQueue).toEqual([])
  })

  test('empty queue is a no-op', () => {
    const idle = fresh()
    expect(drainSteer(idle, 'staff')).toBe(idle)
    let s = send(fresh(), 'hello staff')
    expect(s.threads.staff.steerQueue).toEqual([])
    const before = s.threads.staff.items.length
    s = completeMouth(s, 'staff', 'Hello.')
    expect(s.threads.staff.steerQueue).toEqual([])
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(1)
    expect(s.threads.staff.items.length).toBe(before + 1)
  })

  test('Stop drops a job queue and still sends the user steer', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    expect(s.threads.kernel.mouth).toBe('working')
    const jobId = s.jobs[0]!.id
    s = {
      ...s,
      threads: {
        ...s.threads,
        kernel: {
          ...s.threads.kernel,
          steerQueue: [{ text: 'do this instead' }],
          jobSteerQueue: [{ text: 'internal leftover' }],
        },
      },
    }
    const usersBefore = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    s = stopJob(s, jobId)
    expect(s.jobs[0]?.status).toBe('failed')
    expect(s.threads.kernel.jobSteerQueue).toEqual([])
    const users = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(usersBefore.length + 1)
    if (users.at(-1)?.kind === 'msg') expect(users.at(-1).text).toBe('do this instead')
    expect(s.threads.kernel.steerQueue).toEqual([])
  })

  test('Stop during a job does not drop a queued steer on another mouth', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'Kernel, the ledger replay breaks on the composer path.')
    const jobId = s.jobs[0]!.id
    s = setActive(s, 'staff')
    s = send(s, 'what is the pin?')
    s = send(s, 'make it shorter')
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'make it shorter' }])
    const staffUsers = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(staffUsers).toHaveLength(1)
    s = stopJob(s, jobId)
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'make it shorter' }])
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(1)
    s = completeMouth(s, 'staff', 'The pin is grok-4.6 Extra High plus Fast.')
    const after = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(after).toHaveLength(2)
    if (after[1]?.kind === 'msg') expect(after[1].text).toBe('make it shorter')
  })

  test('computerBusy parks Send so Wave 3 can attach', () => {
    let s = fresh()
    s = {
      ...s,
      threads: { ...s.threads, staff: { ...s.threads.staff, computerBusy: true } },
    }
    s = send(s, 'click the login button')
    expect(s.threads.staff.items).toHaveLength(0)
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'click the login button' }])
    expect(composerEnterBusy(s.threads.staff.mouth, true)).toBe(false)
    s = {
      ...s,
      threads: { ...s.threads, staff: { ...s.threads.staff, computerBusy: false } },
    }
    s = drainSteer(s, 'staff')
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(1)
    if (users[0]?.kind === 'msg') expect(users[0].text).toBe('click the login button')
    expect(s.threads.staff.steerQueue).toEqual([])
  })
})

describe('computer-use workers', () => {
  test('open example.com books a computer worker; Send stays Send and steers off-transcript', () => {
    let s = send(fresh(), 'open example.com')
    expect(s.deskHandoff).toBeFalsy()
    expect(runningComputerWorkers(s)).toHaveLength(1)
    expect(s.threads.staff.computerBusy).toBe(true)
    expect(s.threads.staff.mouth).toBe('working')
    expect(composerEnterBusy(s.threads.staff.mouth, s.threads.staff.computerBusy)).toBe(false)
    expect(pendingMouthTurns(s)).toEqual([])
    s = send(s, 'click the login button')
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'click the login button' }])
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users).toHaveLength(1)
    const workerId = s.computerWorkers?.[0]?.id
    expect(workerId).toBeTruthy()
    s = completeComputer(s, workerId!, 'Opened example.com.')
    const after = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(after).toHaveLength(2)
    if (after[1]?.kind === 'msg') expect(after[1].text).toBe('click the login button')
    expect(s.threads.staff.steerQueue).toEqual([])
  })

  test('password login still hands the operator the stage', () => {
    const s = send(fresh(), 'Can you navigate to the github on your pc so I can login?')
    expect(s.deskHandoff?.instruction).toBe('Sign in to GitHub.')
    expect(runningComputerWorkers(s)).toHaveLength(0)
    expect(s.threads.staff.computerBusy).toBeFalsy()
  })

  test('Kernel computer worker does not declare a Goal complete', () => {
    let s = setActive(fresh(), 'kernel')
    s = send(s, 'open example.com')
    expect(s.goals ?? []).toEqual([])
    expect(s.jobs).toHaveLength(0)
    expect(runningComputerWorkers(s)).toHaveLength(1)
    const workerId = s.computerWorkers![0]!.id
    s = completeComputer(s, workerId, 'Opened example.com.')
    expect(s.goals ?? []).toEqual([])
    expect(s.jobs).toHaveLength(0)
    expect(s.threads.kernel.mouth).toBe('idle')
  })

  test('operator_help parks the worker; Release lets it proceed', () => {
    let s = bookComputer(fresh(), 'staff', 'open a login page')
    const workerId = s.computerWorkers![0]!.id
    s = waitComputerOperator(s, workerId, 'Sign in if this page asks.')
    expect(s.computerWorkers![0]!.status).toBe('waiting_operator')
    expect(s.threads.staff.computerBusy).toBe(true)
    expect(s.deskHandoff?.instruction).toBe('Sign in if this page asks.')
    s = send(s, 'try the next field')
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'try the next field' }])
    s = resumeComputer(s, 'staff')
    expect(runningComputerWorkers(s)).toHaveLength(1)
    s = completeComputer(s, workerId, 'Signed in.')
    expect(s.threads.staff.steerQueue).toEqual([])
  })

  test('remount does not leave computerBusy pinning Send', () => {
    let s = bookComputer(fresh(), 'staff', 'open example.com')
    expect(s.threads.staff.computerBusy).toBe(true)
    s = idleOrphanMouths(s)
    expect(s.threads.staff.computerBusy).toBe(false)
    expect(s.computerWorkers?.[0]?.status).toBe('failed')
    s = send(s, 'hello staff')
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.steerQueue).toEqual([])
  })
})

describe('typed sister hop', () => {
  function answering(session: Session, agentId: string, text = 'Hand this off.'): Session {
    return {
      ...session,
      threads: {
        ...session.threads,
        [agentId]: {
          ...session.threads[agentId]!,
          mouth: 'answer',
          items: [{ kind: 'msg', id: 'ask', from: 'user', agentId, text }],
        },
      },
    }
  }

  test('accepted hop speaks on the asker and lands the mandate on the addressee', () => {
    let s = answering(fresh(), 'staff')
    s = completeMouth(
      s,
      'staff',
      '{"type":"hop","to":"kernel","task":"Check the pin.","constraints":"No merge.","expecting":"A one-line status."}',
    )
    const staffLast = s.threads.staff.items.at(-1)
    expect(staffLast?.kind === 'msg' && staffLast.text).toBe('Handed to Kernel.')
    expect(staffLast?.kind === 'msg' && staffLast.sisterHop).toEqual({ to: 'kernel', depth: 0 })
    const mandate = s.threads.kernel.items.find((item) => item.kind === 'msg' && item.from === 'user')
    expect(mandate?.kind === 'msg' && mandate.text).toBe(
      'Task: Check the pin.\nConstraints: No merge.\nExpecting: A one-line status.',
    )
    expect(mandate?.kind === 'msg' && mandate.sisterHop).toEqual({ to: 'kernel', depth: 0 })
    expect(s.threads.staff.mouth).toBe('idle')
  })

  test('staff is not a hop target; hidden sister is refused; blank task does not parse', () => {
    let s = answering(fresh(), 'kernel')
    s = offerSisterHop(s, {
      from: 'kernel',
      to: 'staff',
      task: 'Report back.',
      depth: 1,
    })
    expect(s.threads.kernel.items.at(-1)).toMatchObject({ text: 'Staff is not a hop target.' })
    expect(s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(0)

    s = answering(fresh(), 'staff')
    s = {
      ...s,
      agents: s.agents.map((agent) => (agent.id === 'kernel' ? { ...agent, hidden: true } : agent)),
    }
    s = offerSisterHop(s, { from: 'staff', to: 'kernel', task: 'Check the pin.', depth: 0 })
    expect(s.threads.staff.items.at(-1)).toMatchObject({ text: 'That automaton is not on the rail.' })
    expect(s.threads.kernel.items).toEqual([])

    s = offerSisterHop(answering(fresh(), 'staff'), { from: 'staff', to: 'kernel', task: '', depth: 0 })
    expect(s.threads.staff.items.at(-1)).toMatchObject({ text: 'Need a task to hand off.' })
    expect(s.threads.kernel.items).toEqual([])
  })

  test('depth cap and per-turn cap refuse instead of truncating', () => {
    let s = answering(fresh(), 'kernel', 'Task: Check the pin.')
    s = {
      ...s,
      threads: {
        ...s.threads,
        kernel: {
          ...s.threads.kernel,
          items: [
            {
              kind: 'msg',
              id: 'ask',
              from: 'user',
              agentId: 'kernel',
              text: 'Task: Check the pin.',
              sisterHop: { to: 'kernel', depth: 1 },
            },
          ],
        },
      },
    }
    s = completeMouth(s, 'kernel', '{"type":"hop","to":"research","task":"Look this up."}')
    expect(s.threads.kernel.items.at(-1)).toMatchObject({ text: 'That hop is too deep.' })
    expect(s.threads.research.items).toEqual([])

    s = answering(fresh(), 'staff')
    s = offerSisterHop(s, { from: 'staff', to: 'kernel', task: 'First.', depth: 0 })
    s = offerSisterHop(s, { from: 'staff', to: 'research', task: 'Second.', depth: 0 })
    const before = s.threads.research.items.length
    s = offerSisterHop(s, { from: 'staff', to: 'kernel', task: 'Third.', depth: 0 })
    expect(s.threads.staff.items.at(-1)).toMatchObject({ text: 'Already handed off enough this turn.' })
    expect(s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(1)
    expect(s.threads.research.items.length).toBe(before)
  })
})

function setThreadEmpty(session: Session, agentId: string): Session {
  return {
    ...session,
    threads: {
      ...session.threads,
      [agentId]: { ...session.threads[agentId]!, items: [], mouth: 'idle', unread: 0 },
    },
  }
}

