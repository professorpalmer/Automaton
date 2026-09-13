import { describe, expect, test } from 'bun:test'
import { COMPOSER_MAX_ROWS, COMPOSER_MIN_ROWS } from '../src/chrome/composer'
import {
  applyMention,
  collectMentions,
  filterMentions,
  mentionQueryAt,
} from '../src/chrome/mention'

describe('composer # mention picker', () => {
  test('caret-at-end hash query; filter; insert product tokens', () => {
    expect(mentionQueryAt('hello')).toBeNull()
    expect(mentionQueryAt('# heading')).toBeNull()
    expect(mentionQueryAt('see #sk')).toEqual({ start: 4, query: 'sk' })
    expect(mentionQueryAt('#')).toEqual({ start: 0, query: '' })
    const items = collectMentions({
      agents: [{ id: 'staff', name: 'Chief of Staff' }, { id: 'ghost', name: 'Hidden', hidden: true }],
      skills: [
        { id: 'ship-notes', name: 'Ship notes', enabled: true, description: 'use this when shipping' },
        { id: 'off', name: 'Off', enabled: false },
      ],
      rooms: [
        { id: 'room_1', name: 'standup' },
        { id: 'room_2', name: 'old', archived: true },
      ],
    })
    expect(items.map((row) => row.kind)).toEqual(['skill', 'room', 'agent'])
    expect(items.find((row) => row.kind === 'skill')?.insert).toBe('@ship-notes')
    expect(filterMentions(items, 'ship').map((row) => row.id)).toEqual(['ship-notes'])
    expect(applyMention('pin #sh', items[0]!)).toBe('pin @ship-notes ')
    expect(COMPOSER_MIN_ROWS).toBe(1)
    expect(COMPOSER_MAX_ROWS).toBe(8)
  })
})
