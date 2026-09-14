import { describe, expect, test } from 'bun:test'
import { emptyThreads, resetIdsForTests, staffWithSisters, type FeedItem } from '../src/domain'
import {
  activityHeaderSummary,
  activityKindFor,
  formatActivityLabel,
  formatBytes,
  isWriteActivity,
  sessionActivityForSister,
  sessionActivityFromActions,
  sessionActivityFromFeed,
} from '../src/runtime/session-activity'
import { buildActionEvent } from '../src/runtime/mouth-stream'
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

describe('session activity (Wave 4 P2)', () => {
  test('formatBytes and write labels never invent contents', () => {
    expect(formatBytes(420)).toBe('420 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(isWriteActivity('copy_out', 'copy_out')).toBe(true)
    expect(isWriteActivity('shell', 'box_shell')).toBe(false)
    expect(activityKindFor('box_shell', 'shell')).toBe('command')
    expect(activityKindFor('copy_in', 'copy_in')).toBe('file')
    expect(
      formatActivityLabel({
        kind: 'file',
        intent: 'copy_out',
        tool: 'copy_out',
        path: '/tmp/out.bin',
        bytes: 1024,
      }),
    ).toBe('copy_out /tmp/out.bin · 1.0 KB')
    expect(
      formatActivityLabel({
        kind: 'command',
        intent: 'shell',
        tool: 'box_shell',
        path: 'echo secret-token',
      }),
    ).toBe('shell')
    expect(
      formatActivityLabel({
        kind: 'command',
        intent: 'shell',
        tool: 'box_shell',
        path: 'echo secret-token',
      }),
    ).not.toContain('secret')
  })

  test('derives ephemeral Activity from mouth-stream feed — not a second DB', () => {
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
    session = appendMouthStream(session, 'kernel', {
      phase: 'decide',
      tool: 'copy_out',
      intent: 'copy_out',
      detail: '/home/box/out.bin',
      bytes: 2048,
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'act',
      tool: 'copy_out',
      intent: 'copy_out',
      detail: '/home/box/out.bin',
      bytes: 2048,
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'done',
      tool: 'copy_out',
      intent: 'copy_out',
      detail: '/home/box/out.bin',
      bytes: 2048,
    })
    const feed = session.threads.kernel?.items ?? []
    const rows = sessionActivityFromFeed(feed)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.kind).toBe('command')
    expect(rows[0]?.label).toBe('shell')
    expect(rows[1]?.kind).toBe('file')
    expect(rows[1]?.path).toBe('/home/box/out.bin')
    expect(rows[1]?.bytes).toBe(2048)
    expect(rows[1]?.label).toContain('/home/box/out.bin')
    expect(rows[1]?.label).toContain('KB')
    expect(activityHeaderSummary(rows)).toContain('shell')
    expect(activityHeaderSummary(rows)).toContain('write')
    // Sister isolation: staff feed empty → no activity
    expect(sessionActivityFromFeed(session.threads.staff?.items ?? [])).toEqual([])
  })

  test('falls back to action ledger events when feed has no stream rows', () => {
    const events = [
      buildActionEvent({
        ownerAgentId: 'kernel',
        tool: 'copy_in',
        intent: 'copy_in',
        decision: 'permit',
        reason: 'copy_in',
        path: '/Users/cary/secret.txt',
        bytes: 12,
        initiatorKind: 'person',
      }),
    ]
    const rows = sessionActivityFromActions(events)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('copy_in /Users/cary/secret.txt · 12 B')
    expect(JSON.stringify(rows)).not.toContain('file contents')
    const feed: FeedItem[] = []
    expect(sessionActivityForSister({ feed, actions: events })).toEqual(rows)
  })

  test('refuse rows keep danger-facing label without contents', () => {
    const feed: FeedItem[] = [
      {
        kind: 'mouth-stream',
        id: 's1',
        agentId: 'staff',
        phase: 'refuse',
        tool: 'host_shell',
        intent: 'host_shell',
        at: 1,
      },
    ]
    const rows = sessionActivityFromFeed(feed)
    expect(rows[0]?.decision).toBe('refuse')
    expect(rows[0]?.label.startsWith('refuse')).toBe(true)
  })
})
