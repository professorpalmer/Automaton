import { describe, expect, test } from 'bun:test'
import { deal, markForId, seedOverride } from '../src/runtime/deal'

describe('mark deal', () => {
  test('host deals for the seed ids before override', () => {
    expect(deal('staff')).toEqual({ shape: 'teardrop', color: 'magenta' })
    expect(deal('kernel')).toEqual({ shape: 'wedge', color: 'red' })
    expect(deal('research')).toEqual({ shape: 'wedge', color: 'green' })
  })

  test('seed override keeps graphite trio marks', () => {
    expect(seedOverride('staff')).toEqual({ shape: 'blob', color: 'staff' })
    expect(markForId('staff')).toEqual({ shape: 'blob', color: 'staff' })
    expect(markForId('kernel')).toEqual({ shape: 'hex', color: 'kernel' })
    expect(markForId('research')).toEqual({ shape: 'tablet', color: 'research' })
  })

  test('a factory id deals a catalog shape and hue', () => {
    const mark = deal('agent_1')
    expect(mark.shape).toBeTruthy()
    expect(mark.color).not.toBe('black')
    expect(markForId('agent_1')).toEqual(mark)
  })
})
