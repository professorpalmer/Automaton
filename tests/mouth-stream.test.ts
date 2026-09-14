import { describe, expect, test } from 'bun:test'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import {
  initiatorFromKickoff,
  mouthStreamFeedItem,
  mouthStreamLabel,
  recordSideEffect,
  finishSideEffect,
  buildActionEvent,
} from '../src/runtime/mouth-stream'
import { appendMouthStream, type Session } from '../src/session'

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

describe('mouth stream + initiator ledger', () => {
  test('initiatorFromKickoff maps user→person and keeps sisters of kickoff', () => {
    expect(initiatorFromKickoff('user')).toBe('person')
    expect(initiatorFromKickoff('routine')).toBe('routine')
    expect(initiatorFromKickoff('peer-hop')).toBe('peer-hop')
    expect(initiatorFromKickoff('channel')).toBe('channel')
    expect(initiatorFromKickoff('webhook')).toBe('webhook')
    expect(initiatorFromKickoff('intro')).toBe('unknown')
    expect(initiatorFromKickoff('unknown')).toBe('unknown')
    expect(initiatorFromKickoff(undefined)).toBe('unknown')
  })

  test('mouthStreamLabel never invents secret contents', () => {
    expect(mouthStreamLabel('act', 'box_read', 'read', '/tmp/x')).toBe('act · box_read · read · /tmp/x')
    expect(mouthStreamLabel('refuse', 'host_shell', 'host_shell')).toBe('refuse · host_shell · host_shell')
  })

  test('appendMouthStream paints on one sister thread only', () => {
    let session = fresh()
    session = appendMouthStream(session, 'kernel', {
      phase: 'decide',
      tool: 'box_shell',
      intent: 'shell',
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'act',
      tool: 'box_shell',
      intent: 'shell',
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'done',
      tool: 'box_shell',
      intent: 'shell',
    })
    const kernel = session.threads.kernel?.items ?? []
    const staff = session.threads.staff?.items ?? []
    expect(kernel.map((row) => row.kind)).toEqual(['mouth-stream', 'mouth-stream', 'mouth-stream'])
    expect(kernel.every((row) => row.kind === 'mouth-stream' && row.agentId === 'kernel')).toBe(true)
    expect(staff).toEqual([])
    const phases = kernel.map((row) => (row.kind === 'mouth-stream' ? row.phase : null))
    expect(phases).toEqual(['decide', 'act', 'done'])
  })

  test('recordSideEffect decide→act→done and refuse path', () => {
    const events = [] as ReturnType<typeof buildActionEvent>[]
    const phases: string[] = []
    const seams = {
      recordAction: (event: (typeof events)[number]) => events.push(event),
      emitMouthStream: (step: { phase: string }) => phases.push(step.phase),
    }
    recordSideEffect(seams, {
      ownerAgentId: 'staff',
      tool: 'box_read',
      intent: 'read',
      decision: 'permit',
      reason: 'read',
      path: '/tmp/a',
      initiatorKind: 'person',
    })
    finishSideEffect(seams, {
      ownerAgentId: 'staff',
      tool: 'box_read',
      intent: 'read',
      path: '/tmp/a',
    })
    expect(events[0]?.initiatorKind).toBe('person')
    expect(phases).toEqual(['decide', 'act', 'done'])

    phases.length = 0
    events.length = 0
    recordSideEffect(seams, {
      ownerAgentId: 'staff',
      tool: 'host_shell',
      intent: 'host_shell',
      decision: 'refuse',
      reason: 'host_denied',
      initiatorKind: 'routine',
    })
    expect(events[0]?.decision).toBe('refuse')
    expect(phases).toEqual(['decide', 'refuse'])
  })

  test('mouthStreamFeedItem is feed-safe (no secret payload keys)', () => {
    resetIdsForTests()
    const item = mouthStreamFeedItem({
      agentId: 'staff',
      phase: 'act',
      tool: 'box_computer',
      intent: 'type',
      detail: undefined,
    })
    expect(item.kind).toBe('mouth-stream')
    expect(JSON.stringify(item)).not.toContain('secret')
    expect(JSON.stringify(item)).not.toContain('password')
  })
})
