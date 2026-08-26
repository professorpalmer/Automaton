import { describe, expect, test } from 'bun:test'
import { DEAL_SHAPES, deal, markForId, seedOverride } from '../src/runtime/deal'

describe('mark deal', () => {
  test('host deals are stable and never black', () => {
    expect(deal('staff')).toEqual(deal('staff'))
    expect(DEAL_SHAPES).toContain(deal('staff').shape)
    expect(deal('staff').color).not.toBe('black')
    expect(deal('kernel')).not.toEqual(deal('staff'))
    expect(deal('research')).not.toEqual(deal('kernel'))
  })

  test('seed override keeps graphite trio marks', () => {
    expect(seedOverride('staff')).toEqual({ shape: 'blob', color: 'staff' })
    expect(markForId('staff')).toEqual({ shape: 'blob', color: 'staff' })
    expect(markForId('kernel')).toEqual({ shape: 'hex', color: 'kernel' })
    expect(markForId('research')).toEqual({ shape: 'tablet', color: 'research' })
  })

  test('a factory id deals a catalog shape and hue', () => {
    const mark = deal('agent_1')
    expect(DEAL_SHAPES).toContain(mark.shape)
    expect(mark.color).not.toBe('black')
    expect(markForId('agent_1')).toEqual(mark)
  })
})
