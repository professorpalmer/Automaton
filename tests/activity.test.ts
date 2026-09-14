import { describe, expect, test } from 'bun:test'
import {
  activityExpanded,
  activityPaintKey,
  activityVisible,
  pressActivityHeader,
} from '../src/chrome/activity'

describe('activity takeover', () => {
  test('streaming alone does not open Activity — mouth wait is the bubble', () => {
    expect(activityVisible({ streaming: true, held: null })).toBe(false)
    expect(activityExpanded({ streaming: true, held: null })).toBe(false)
    expect(activityPaintKey({ streaming: true, held: null })).toBe('parked')
    expect(activityVisible({ streaming: false, held: null })).toBe(false)
  })

  test('streaming with session activity auto-opens; header press locks', () => {
    const live = { streaming: true, held: null as boolean | null, hasSessionActivity: true }
    expect(activityVisible(live)).toBe(true)
    expect(activityExpanded(live)).toBe(true)
    const closed = pressActivityHeader(live)
    expect(closed.held).toBe(false)
    expect(activityExpanded(closed)).toBe(false)
    // locked closed while streaming+session → still visible (held false) — wait, held false parks
    expect(activityVisible(closed)).toBe(false)
    const opened = pressActivityHeader({ ...closed, held: false })
    // press toggles held to true
    expect(opened.held).toBe(true)
    expect(activityVisible({ streaming: false, held: true })).toBe(true)
    expect(activityExpanded({ streaming: false, held: true })).toBe(true)
    expect(activityPaintKey({ streaming: true, held: null, hasSessionActivity: true }, 'analyze:1')).toBe(
      'open:live:analyze:1',
    )
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
