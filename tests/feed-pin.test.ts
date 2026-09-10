import { describe, expect, test } from 'bun:test'
import type { FeedItem } from '../src/domain'
import {
  FEED_TAIL,
  STREAM_COMMIT_MS,
  cancelFeedPin,
  feedFollowFromPark,
  feedGrowKey,
  feedPinIdentity,
  paintedFeedCount,
  pinFeedTail,
  scheduleFeedPin,
  shouldPinFeedTail,
} from '../src/runtime/feed-pin'

const lines: FeedItem[] = [
  { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hi' },
  { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'hello' },
]

describe('feed pin identity', () => {
  test('STREAM_COMMIT stays a 120ms coalesce', () => {
    expect(STREAM_COMMIT_MS).toBe(120)
  })

  test('last-message growth does not change identity', () => {
    const grown: FeedItem[] = [
      lines[0]!,
      { ...lines[1]!, text: `${lines[1]!.kind === 'msg' ? lines[1]!.text : ''} and more` },
    ]
    expect(feedPinIdentity(lines, 0, false)).toBe(feedPinIdentity(grown, 0, false))
    expect(feedPinIdentity(lines, 0, false)).not.toContain(String(grown[1] && grown[1].kind === 'msg' ? grown[1].text.length : ''))
    expect(feedGrowKey(grown)).not.toBe(feedGrowKey(lines))
  })

  test('new last id, thinking, and dock pad change identity', () => {
    const next = [...lines, { kind: 'msg', id: 'a2', from: 'agent' as const, agentId: 'staff', text: 'later' }]
    expect(feedPinIdentity(next, 0, false)).not.toBe(feedPinIdentity(lines, 0, false))
    expect(feedPinIdentity(lines, 0, true)).not.toBe(feedPinIdentity(lines, 0, false))
    expect(feedPinIdentity(lines, 8, false)).not.toBe(feedPinIdentity(lines, 0, false))
  })

  test('painted count skips inbound relays and notes', () => {
    const mixed: FeedItem[] = [
      ...lines,
      { kind: 'relay', id: 'r1', lane: 'sent', peerId: 'research', text: 'go' },
      { kind: 'relay', id: 'r2', lane: 'from', peerId: 'research', text: 'back' },
      { kind: 'agent_note', id: 'n1', fromId: 'staff', toId: 'research', text: 'note' },
    ]
    expect(paintedFeedCount(mixed, false)).toBe(3)
    expect(paintedFeedCount(mixed, true)).toBe(4)
  })
})

describe('should pin the tail', () => {
  test('mount and identity pin even when already near the park', () => {
    expect(shouldPinFeedTail({ reason: 'mount', nearBottom: true, atTail: true })).toBe(true)
    expect(shouldPinFeedTail({ reason: 'identity', nearBottom: false, atTail: true })).toBe(true)
  })

  test('grow pins only when follow-tail matters and the park moved', () => {
    expect(shouldPinFeedTail({ reason: 'grow', nearBottom: true, atTail: false })).toBe(true)
    expect(shouldPinFeedTail({ reason: 'grow', nearBottom: true, atTail: true })).toBe(false)
    expect(shouldPinFeedTail({ reason: 'grow', nearBottom: false, atTail: false })).toBe(false)
  })

  test('parked offset treats a small drift as still on the tail', () => {
    expect(feedFollowFromPark(FEED_TAIL, FEED_TAIL)).toEqual({ nearBottom: true, atTail: true })
    expect(feedFollowFromPark(-400, -400)).toEqual({ nearBottom: true, atTail: true })
    expect(feedFollowFromPark(-390, -400)).toEqual({ nearBottom: true, atTail: false })
    expect(feedFollowFromPark(0, -400)).toEqual({ nearBottom: false, atTail: false })
    expect(feedFollowFromPark(null, -400)).toEqual({ nearBottom: true, atTail: false })
  })
})

describe('pinFeedTail', () => {
  test('scrolls to the last painted row then the tail park', () => {
    const calls: Array<string | number> = []
    pinFeedTail(
      {
        scrollToItem: (_id, index) => calls.push(`item:${index}`),
        scrollTo: (_id, x, y) => calls.push(`xy:${x},${y}`),
        getScrollOffset: () => [0, -240],
      },
      { id: 7 },
      lines,
      false,
    )
    expect(calls).toEqual(['item:1', `xy:0,${FEED_TAIL}`])
  })

  test('schedule coalesces grow ticks and runs immediately when asked', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null }
    let n = 0
    scheduleFeedPin(() => {
      n += 1
    }, timer, 0)
    expect(n).toBe(1)
    scheduleFeedPin(() => {
      n += 1
    }, timer, 50)
    scheduleFeedPin(() => {
      n += 1
    }, timer, 50)
    expect(n).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(n).toBe(2)
    cancelFeedPin(timer)
  })
})
