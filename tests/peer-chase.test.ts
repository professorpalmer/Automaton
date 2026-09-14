import { describe, expect, test } from 'bun:test'
import {
  emptyThreads,
  expectingMet,
  isSeatWorking,
  resetIdsForTests,
  staffWithSisters,
} from '../src/domain'
import {
  completeMouth,
  failMouth,
  offerSisterHop,
  pendingMouthTurns,
  sendToAgent,
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

function finishSister(session: Session, agentId: string, spoken: string): Session {
  const row = session.threads[agentId]
  if (!row) return session
  return completeMouth(
    {
      ...session,
      threads: { ...session.threads, [agentId]: { ...row, mouth: 'answer' } },
    },
    agentId,
    spoken,
  )
}

describe('Wave 5 P0 peer chase', () => {
  test('offerSisterHop and sendToAgent set pendingHops; return clears them', () => {
    let s = answering(fresh(), 'staff')
    s = completeMouth(
      s,
      'staff',
      '{"type":"hop","to":"kernel","task":"Check the pin.","constraints":"No merge.","expecting":"A one-line status."}',
    )
    expect(s.threads.staff.pendingHops).toEqual([
      {
        to: 'kernel',
        task: 'Check the pin.',
        constraints: 'No merge.',
        expecting: 'A one-line status.',
      },
    ])
    expect(s.threads.staff.mouth).toBe('idle')
    expect(isSeatWorking(s.threads.staff.mouth, false, s.threads.staff.pendingHops)).toBe(true)

    s = finishSister(s, 'kernel', 'The pin is green.')
    expect(s.threads.staff.pendingHops).toEqual([])
    expect(s.threads.staff.mouth).toBe('answer')
    expect(isSeatWorking(s.threads.staff.mouth, false, s.threads.staff.pendingHops)).toBe(true)

    s = fresh()
    s = sendToAgent(s, 'staff', 'kernel', 'Please look at the open PRs')
    expect(s.threads.staff.pendingHops).toEqual([{ to: 'kernel', task: 'Please look at the open PRs' }])
    expect(isSeatWorking('idle', false, s.threads.staff.pendingHops)).toBe(true)
    s = finishSister(s, 'kernel', 'There are 2 open PRs.')
    expect(s.threads.staff.pendingHops).toEqual([])
    expect(s.threads.staff.mouth).toBe('answer')
  })

  test('unmet expecting injects chase prompt and allows another hop', () => {
    const expecting = 'CPU, memory, and disk numbers'
    expect(expectingMet('Connected via SSH to the instance.', expecting)).toBe(false)
    let s = answering(fresh(), 'staff', 'SSH EC2 stats')
    s = completeMouth(
      s,
      'staff',
      JSON.stringify({
        type: 'hop',
        to: 'kernel',
        task: 'SSH to the box and return stats.',
        expecting,
      }),
    )
    expect(s.threads.staff.pendingHops[0]?.expecting).toBe(expecting)
    s = finishSister(s, 'kernel', 'Connected via SSH to the instance.')
    const pending = pendingMouthTurns(s)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.mode).toBe('assess')
    expect(pending[0]?.userText).toContain('Kernel answered:')
    expect(pending[0]?.userText).toContain('Connected via SSH to the instance.')
    expect(pending[0]?.userText).toContain(`You asked for: ${expecting}`)
    expect(pending[0]?.userText).toContain('scheduler for this chase')
    expect(pending[0]?.userText).not.toContain('You are copy, not the scheduler.')

    s = completeMouth(
      s,
      'staff',
      JSON.stringify({
        type: 'hop',
        to: 'kernel',
        task: 'Return CPU, memory, and disk figures, not a connect line.',
        expecting,
      }),
    )
    expect(s.threads.staff.pendingHops).toEqual([
      {
        to: 'kernel',
        task: 'Return CPU, memory, and disk figures, not a connect line.',
        expecting,
      },
    ])
    expect(s.threads.staff.mouth).toBe('idle')
    const mandates = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(mandates.length).toBeGreaterThanOrEqual(2)
    expect(String(mandates.at(-1)?.kind === 'msg' ? mandates.at(-1).text : '')).toContain('Expecting: CPU, memory, and disk numbers')
  })

  test('met expecting is copy; head answers once without another hop', () => {
    let s = answering(fresh(), 'staff')
    s = offerSisterHop(s, {
      from: 'staff',
      to: 'kernel',
      task: 'Check the pin.',
      expecting: 'A one-line status.',
      depth: 0,
    })
    s = finishSister(s, 'kernel', 'The pin is green.')
    const pending = pendingMouthTurns(s)
    expect(pending[0]?.userText).toContain('You asked for: A one-line status.')
    expect(pending[0]?.userText).toContain('You are copy, not the scheduler.')
    expect(pending[0]?.userText).not.toContain('scheduler for this chase')
    const kernelUsers = s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user').length
    s = completeMouth(s, 'staff', 'Kernel says the pin is green.')
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.staff.pendingHops).toEqual([])
    expect(s.threads.staff.items.at(-1)).toMatchObject({ text: 'Kernel says the pin is green.' })
    expect(s.threads.kernel.items.filter((item) => item.kind === 'msg' && item.from === 'user')).toHaveLength(
      kernelUsers,
    )
    expect(pendingMouthTurns(s)).toEqual([])
  })

  test('empty sister auto-wakes head with a failure notice', () => {
    let s = answering(fresh(), 'staff')
    s = offerSisterHop(s, {
      from: 'staff',
      to: 'kernel',
      task: 'SSH EC2 stats',
      expecting: 'CPU, memory, and disk numbers',
      depth: 0,
    })
    const kernelAgentBefore = s.threads.kernel.items.filter(
      (item) => item.kind === 'msg' && item.from === 'agent',
    ).length
    s = finishSister(s, 'kernel', '   ')
    const kernelAgentAfter = s.threads.kernel.items.filter(
      (item) => item.kind === 'msg' && item.from === 'agent',
    ).length
    expect(kernelAgentAfter).toBe(kernelAgentBefore)
    expect(s.threads.staff.pendingHops).toEqual([])
    expect(s.threads.staff.mouth).toBe('answer')
    const from = s.threads.staff.items.find((item) => item.kind === 'relay' && item.lane === 'from')
    expect(from?.kind === 'relay' && from.failed === true).toBe(true)
    expect(from?.kind === 'relay' && from.text).toBe('Kernel did not come back (SSH EC2 stats).')
    const pending = pendingMouthTurns(s)
    expect(pending[0]?.mode).toBe('assess')
    expect(pending[0]?.userText).toContain('Kernel did not come back (SSH EC2 stats).')
    expect(pending[0]?.userText).toContain('Tell the person plainly that it did not come back')
    expect(pending[0]?.userText).not.toContain('You are copy, not the scheduler.')
  })

  test('sister failMouth notices the head without a user nudge', () => {
    let s = answering(fresh(), 'staff')
    s = offerSisterHop(s, {
      from: 'staff',
      to: 'kernel',
      task: 'SSH EC2 stats',
      depth: 0,
    })
    const row = s.threads.kernel
    s = failMouth(
      { ...s, threads: { ...s.threads, kernel: { ...row!, mouth: 'answer' } } },
      'kernel',
      'SSH timed out.',
    )
    expect(s.threads.staff.mouth).toBe('answer')
    expect(s.threads.staff.pendingHops).toEqual([])
    const pending = pendingMouthTurns(s)
    expect(pending[0]?.userText).toContain('Kernel did not come back')
    expect(pending[0]?.userText).toContain('Do not wait for the operator to re-ask')
  })
})
