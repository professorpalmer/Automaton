import { describe, expect, test } from 'bun:test'
import { copiedInTests } from '../src/runtime/clipboard'
import {
  copyFeedSelection,
  feedMsgIds,
  selectFeedRange,
  selectedFeedText,
} from '../src/runtime/feed-select'
import type { FeedItem } from '../src/domain'

const items: FeedItem[] = [
  { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hello from the right' },
  { kind: 'relay', id: 'r1', lane: 'sent', peerId: 'research', text: 'skip me' },
  { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'the line worth sharing' },
  { kind: 'msg', id: 'a2', from: 'agent', agentId: 'staff', text: 'a later finding' },
]

describe('feed selection copy', () => {
  test('copy selected ids joins bubble text with a blank line', () => {
    expect(feedMsgIds(items)).toEqual(['u1', 'a1', 'a2'])
    expect(selectedFeedText(items, ['u1', 'a1'])).toBe('hello from the right\n\nthe line worth sharing')
    expect(copyFeedSelection(items, ['u1', 'a1'])).toBe(true)
    expect(copiedInTests()).toBe('hello from the right\n\nthe line worth sharing')
  })

  test('Cmd+A selects all msgs and copy uses them', () => {
    const ids = feedMsgIds(items)
    expect(ids).toEqual(['u1', 'a1', 'a2'])
    expect(selectedFeedText(items, ids)).toBe(
      'hello from the right\n\nthe line worth sharing\n\na later finding',
    )
  })

  test('copy with no selection uses the last clicked bubble', () => {
    expect(selectedFeedText(items, [], 'a1')).toBe('the line worth sharing')
    expect(copyFeedSelection(items, new Set(), 'a1')).toBe(true)
    expect(copiedInTests()).toBe('the line worth sharing')
  })

  test('shift-click range covers msgs between anchors', () => {
    expect(selectFeedRange(feedMsgIds(items), 'u1', 'a2')).toEqual(['u1', 'a1', 'a2'])
    expect(selectFeedRange(feedMsgIds(items), 'a2', 'u1')).toEqual(['u1', 'a1', 'a2'])
  })
})
