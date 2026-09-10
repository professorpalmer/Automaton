import { describe, expect, test } from 'bun:test'
import { feedRowFingerprint, sameFeedRowFingerprint } from '../src/runtime/feed-row'

describe('feed row fingerprint', () => {
  test('growing the last line leaves earlier rows unchanged', () => {
    const first = feedRowFingerprint({
      kind: 'msg',
      id: 'u1',
      from: 'user',
      text: 'hello from the right',
      mine: true,
      gap: 0,
    })
    const last = feedRowFingerprint({
      kind: 'msg',
      id: 'a1',
      from: 'agent',
      text: 'hi',
      mine: false,
      gap: 28,
    })
    const grown = feedRowFingerprint({
      kind: 'msg',
      id: 'a1',
      from: 'agent',
      text: 'hi and then the mouth keeps speaking',
      mine: false,
      gap: 28,
    })
    expect(first).toBe(
      feedRowFingerprint({
        kind: 'msg',
        id: 'u1',
        from: 'user',
        text: 'hello from the right',
        mine: true,
        gap: 0,
      }),
    )
    expect(grown).not.toBe(last)
    expect(sameFeedRowFingerprint({ fingerprint: first }, { fingerprint: first })).toBe(true)
    expect(sameFeedRowFingerprint({ fingerprint: last }, { fingerprint: grown })).toBe(false)
  })

  test('selection and copy marks are part of the paint key', () => {
    const base = { kind: 'msg' as const, id: 'a1', text: 'line', from: 'agent' }
    expect(feedRowFingerprint({ ...base, selected: true })).not.toBe(feedRowFingerprint({ ...base, selected: false }))
    expect(feedRowFingerprint({ ...base, copied: true })).not.toBe(feedRowFingerprint(base))
  })
})
