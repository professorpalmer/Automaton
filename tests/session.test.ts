import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyThreads, MANDATE_MAX_STEPS, resetIdsForTests, staffWithSisters } from '../src/domain'
import { writeProfile } from '../src/runtime/profile'
import {
  addLiveAgent,
  attachPmJob,
  completeJob,
  completeMouth,
  confirmFanout,
  dropLiveAgent,
  dropPendingPath,
  failJob,
  failMouth,
  idleOrphanMouths,
  noteJobStatus,
  pendingMouthTurns,
  queuePaths,
  send,
  setActive,
  setDraft,
  stopJob,
  type Session,
} from '../src/session'

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
    expect(s.threads.agent_pm.mouth).toBe('answer')
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
    expect(s.threads.agent_mn.mouth).toBe('answer')
    expect(s.threads.agent_pm.mouth).toBe('answer')
    expect(s.threads.agent_mn.items.some((item) => item.kind === 'agent_note')).toBe(true)
    expect(s.threads.agent_pm.items.some((item) => item.kind === 'agent_note')).toBe(true)
    expect(s.threads.staff.mouth).not.toBe('answer')
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
    expect(s.threads.staff.mandate?.text).toContain('python')
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
    expect(s.threads.staff.mandate).toBeUndefined()
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
    expect(s.threads.kernel.mandate).toBeUndefined()
  })

  test('Staff assess waits until the sister mandate is closed', () => {
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

  test('Stop closes the mandate and does not book leftover', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    s = stopJob(s, s.jobs[0].id)
    expect(s.jobs[0]?.status).toBe('failed')
    expect(s.jobs).toHaveLength(1)
    expect(s.threads.staff.mandate).toBeUndefined()
    expect(s.threads.staff.mouth).toBe('idle')
  })

  test('failed first step still books a different leftover step', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    s = failJob(s, s.jobs[0].id, "Didn't land.")
    expect(s.jobs).toHaveLength(2)
    expect(s.jobs[1]?.kind).toBe('box-shell')
    expect(s.jobs[1]?.goal.toLowerCase()).toContain('python')
    expect(s.threads.staff.mouth).toBe('working')
  })

  test('mandate cap stops leftover dispatch', () => {
    let s = send(fresh(), 'install curl on the computer then check if python is on PATH')
    const mandate = s.threads.staff.mandate
    expect(mandate).toBeTruthy()
    s = {
      ...s,
      threads: {
        ...s.threads,
        staff: { ...s.threads.staff, mandate: { ...mandate!, steps: MANDATE_MAX_STEPS } },
      },
    }
    s = completeJob(s, s.jobs[0].id, 'curl is installed.')
    expect(s.jobs).toHaveLength(1)
    expect(s.threads.staff.mandate).toBeUndefined()
    expect(s.threads.staff.mouth).toBe('idle')
  })
})
