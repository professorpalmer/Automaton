import { describe, expect, test } from 'bun:test'
import {
  activityExpanded,
  activityPaintKey,
  activityVisible,
  pressActivityHeader,
} from '../src/chrome/activity'

describe('activity takeover', () => {
  test('auto-opens while streaming; header press locks', () => {
    expect(activityVisible({ streaming: true, held: null })).toBe(true)
    expect(activityExpanded({ streaming: true, held: null })).toBe(true)
    expect(activityVisible({ streaming: false, held: null })).toBe(false)
    const closed = pressActivityHeader({ streaming: true, held: null })
    expect(closed.held).toBe(false)
    expect(activityExpanded(closed)).toBe(false)
    expect(activityVisible(closed)).toBe(true)
    const opened = pressActivityHeader(closed)
    expect(opened.held).toBe(true)
    expect(activityVisible({ streaming: false, held: true })).toBe(true)
    expect(activityExpanded({ streaming: false, held: true })).toBe(true)
    expect(activityPaintKey({ streaming: false, held: null })).toBe('parked')
    expect(activityPaintKey({ streaming: true, held: null }, 'analyze:1')).toBe('open:live:analyze:1')
  })

  test('session activity keeps a collapsed strip after stream (Wave 4 P2)', () => {
    expect(activityVisible({ streaming: false, held: null, hasSessionActivity: true })).toBe(true)
    expect(activityExpanded({ streaming: false, held: null, hasSessionActivity: true })).toBe(false)
    expect(activityPaintKey({ streaming: false, held: null, hasSessionActivity: true }, 'shell')).toBe(
      'shut:session:shell',
    )
    // User locked closed → park even if session has activity
    expect(activityVisible({ streaming: false, held: false, hasSessionActivity: true })).toBe(false)
  })
})
