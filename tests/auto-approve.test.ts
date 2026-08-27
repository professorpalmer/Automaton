import { describe, expect, test } from 'bun:test'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import {
  cancelPendingApprovals,
  consumeGrant,
  decideApproval,
  grantOnce,
  isUnattended,
  looksSensitive,
  unattendedApprovalWidget,
} from '../src/runtime/auto-approve.ts'
import {
  answerWidget,
  bookComputer,
  idleOrphanMouths,
  offerUnattendedApproval,
  send,
  setAutoApprove,
  turnKickoff,
  waitComputerHost,
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

function openHost(session: Session) {
  return session.threads.staff.items.find((item) => item.kind === 'widget' && item.status === 'open')
}

describe('unattended is not Auto', () => {
  test('unattended cannot Auto', () => {
    for (const kickoff of ['webhook', 'routine', 'peer-hop', 'intro', 'unknown'] as const) {
      expect(isUnattended(kickoff)).toBe(true)
      const outcome = decideApproval({
        action: 'host_read README.md',
        kickoff,
        autoEnabled: true,
        brokerAlive: true,
      })
      expect(outcome.decision).toBe('ask')
      expect(outcome.reason).toBe('unattended')
    }
  })

  test('user-kicked Auto still works', () => {
    const outcome = decideApproval({
      action: 'host_read README.md',
      kickoff: 'user',
      autoEnabled: true,
      brokerAlive: true,
    })
    expect(outcome.decision).toBe('auto')
    expect(outcome.reason).toBe('auto')
  })

  test('destructive still asks even when Auto is on', () => {
    expect(looksSensitive('cat ~/.env')).toBe(true)
    expect(looksSensitive('rm -rf /tmp/work')).toBe(true)
    expect(looksSensitive('git push --force origin main')).toBe(true)
    expect(looksSensitive('read ~/.ssh/id_ed25519')).toBe(true)
    expect(looksSensitive('host_read README.md')).toBe(false)
    const outcome = decideApproval({
      action: 'rm -rf /Users/carypalmer/.ssh',
      kickoff: 'user',
      autoEnabled: true,
      brokerAlive: true,
    })
    expect(outcome.decision).toBe('ask')
    expect(outcome.reason).toBe('destructive')
  })

  test('dead broker denies', () => {
    const outcome = decideApproval({
      action: 'host_read README.md',
      kickoff: 'user',
      autoEnabled: true,
      brokerAlive: false,
    })
    expect(outcome.decision).toBe('deny')
    expect(outcome.reason).toBe('dead-broker')
  })

  test('allowed-once is not Always-allow', () => {
    const once = grantOnce([], 'host_read README.md')
    const first = decideApproval({
      action: 'host_read README.md',
      kickoff: 'user',
      autoEnabled: false,
      brokerAlive: true,
      grants: once,
    })
    expect(first.decision).toBe('auto')
    expect(first.reason).toBe('grant-once')
    const second = decideApproval({
      action: 'host_read README.md',
      kickoff: 'user',
      autoEnabled: false,
      brokerAlive: true,
      grants: first.grants,
    })
    expect(second.decision).toBe('ask')
    expect(consumeGrant(once, 'host_read README.md').kind).toBe('once')
  })

  test('webhook and routine stubs still paint a widget when Auto is on', () => {
    let s = setAutoApprove(fresh(), true)
    s = offerUnattendedApproval(s, 'staff', 'webhook')
    expect(openHost(s)?.kind).toBe('widget')
    expect(openHost(s)?.status).toBe('open')
    s = offerUnattendedApproval(setAutoApprove(fresh(), true), 'staff', 'routine')
    expect(openHost(s)?.kind).toBe('widget')
    expect(unattendedApprovalWidget('peer-hop').prompt).toContain('peer hop')
  })

  test('session: unattended computer cannot Auto; user-kicked Auto skips the card', () => {
    let unattended = setAutoApprove(fresh(), true)
    unattended = bookComputer(unattended, 'staff', 'read README')
    unattended = waitComputerHost(unattended, unattended.computerWorkers![0]!.id, 'Run this on your Mac?', 'host_read README.md')
    expect(openHost(unattended)?.kind).toBe('widget')
    expect(unattended.computerWorkers![0]!.hostAllowed).toBeUndefined()
    expect(unattended.computerWorkers![0]!.status).toBe('waiting_operator')

    let kicked = setAutoApprove(fresh(), true)
    kicked = send(kicked, 'please read README on my Mac')
    kicked = bookComputer(kicked, 'staff', 'read README')
    expect(turnKickoff(kicked, 'staff')).toBe('user')
    const id = kicked.computerWorkers![0]!.id
    kicked = waitComputerHost(kicked, id, 'Run this on your Mac?', 'host_read README.md')
    expect(openHost(kicked)).toBeUndefined()
    expect(kicked.computerWorkers![0]!.hostAllowed).toBe(true)
    expect(kicked.computerWorkers![0]!.status).toBe('running')
  })

  test('session: destructive still asks; answering once does not enable Auto', () => {
    let s = setAutoApprove(fresh(), true)
    s = send(s, 'clean the folder on my Mac')
    s = bookComputer(s, 'staff', 'clean')
    s = waitComputerHost(s, s.computerWorkers![0]!.id, 'Run this on your Mac?', 'rm -rf /tmp/work')
    const widget = openHost(s)
    expect(widget?.kind).toBe('widget')
    if (!widget || widget.kind !== 'widget') throw new Error('missing widget')
    s = answerWidget(s, widget.id, { values: ['run'] })
    expect(s.autoApprove).toBe(true)
    expect(s.computerWorkers![0]!.hostAllowed).toBe(true)

    let next = setAutoApprove(fresh(), false)
    next = send(next, 'another host read')
    next = bookComputer(next, 'staff', 'read')
    next = waitComputerHost(next, next.computerWorkers![0]!.id, 'Run this on your Mac?', 'host_read README.md')
    expect(openHost(next)?.kind).toBe('widget')
    const card = openHost(next)
    if (!card || card.kind !== 'widget') throw new Error('missing card')
    next = answerWidget(next, card.id, { values: ['run'] })
    expect(next.autoApprove).toBe(false)
    expect(next.computerWorkers![0]!.hostAllowed).toBe(true)
  })

  test('dead broker denies the host turn', () => {
    let s: Session = { ...setAutoApprove(fresh(), true), brokerAlive: false }
    s = send(s, 'read README on my Mac')
    s = bookComputer(s, 'staff', 'read README')
    s = waitComputerHost(s, s.computerWorkers![0]!.id, 'Run this on your Mac?', 'host_read README.md')
    expect(openHost(s)).toBeUndefined()
    expect(s.computerWorkers![0]!.status).toBe('failed')
  })

  test('restart cancels in-flight pending host cards', () => {
    let s = bookComputer(fresh(), 'staff', 'read README')
    s = waitComputerHost(s, s.computerWorkers![0]!.id, 'Run this on your Mac?', 'host_read README.md')
    expect(s.pendingApprovals?.length).toBe(1)
    expect(openHost(s)?.status).toBe('open')
    s = idleOrphanMouths(s)
    expect(s.pendingApprovals).toEqual([])
    expect(cancelPendingApprovals([{ id: 'appr_1', action: 'x', kickoff: 'user' }])).toEqual([])
    const host = s.threads.staff.items.find((item) => item.kind === 'widget')
    expect(host?.kind === 'widget' && host.status).toBe('dismissed')
    expect(s.computerWorkers![0]!.status).toBe('failed')
  })
})
