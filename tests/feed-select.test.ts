import { describe, expect, test } from 'bun:test'
import { copiedInTests } from '../src/runtime/clipboard'
import {
  copyFeedSelection,
  feedMsgIds,
  hitMsgIdAtY,
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

  test('drag from one msg to another uses the same range helper', () => {
    const ids = feedMsgIds(items)
    expect(selectFeedRange(ids, 'u1', 'a1')).toEqual(['u1', 'a1'])
    expect(selectFeedRange(ids, 'a1', 'a2')).toEqual(['a1', 'a2'])
  })

  test('pointer y picks the stacked msg row, last overlap wins', () => {
    const rows = [
      { id: 'u1', y: 0, height: 40 },
      { id: 'a1', y: 40, height: 40 },
      { id: 'a2', y: 80, height: 40 },
    ]
    expect(hitMsgIdAtY(rows, 0)).toBe('u1')
    expect(hitMsgIdAtY(rows, 39)).toBe('u1')
    expect(hitMsgIdAtY(rows, 40)).toBe('a1')
    expect(hitMsgIdAtY(rows, 80)).toBe('a2')
    expect(hitMsgIdAtY(rows, 119)).toBe('a2')
    expect(hitMsgIdAtY(rows, 120)).toBe(null)
    expect(hitMsgIdAtY(rows, -1)).toBe(null)
    expect(hitMsgIdAtY([{ id: 'u1', y: 0, height: 50 }, { id: 'a1', y: 40, height: 40 }], 45)).toBe('a1')
  })
})
