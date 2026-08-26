import { describe, expect, test } from 'bun:test'
import { ledgerRows } from '../src/inspector'
import type { LedgerMetrics } from '../src/runtime/store'

function metrics(partial: Partial<LedgerMetrics>): LedgerMetrics {
  return {
    turns: 0,
    hits: 0,
    misses: 0,
    inferenceAvoided: 0,
    inferenceCalls: 0,
    promptTokens: null,
    completionTokens: null,
    costUsd: null,
    promptTokensKnown: 0,
    promptTokensUnknown: 0,
    completionTokensKnown: 0,
    completionTokensUnknown: 0,
    costKnown: 0,
    costUnknown: 0,
    ...partial,
  }
}

describe('settings usage ledger', () => {
  test('omits token and cost rows when any attempted call lacked the field', () => {
    const rows = ledgerRows(
      metrics({
        turns: 25,
        hits: 1,
        misses: 24,
        inferenceAvoided: 1,
        inferenceCalls: 24,
        promptTokens: null,
        completionTokens: null,
        costUsd: null,
        promptTokensKnown: 22,
        promptTokensUnknown: 2,
        completionTokensKnown: 22,
        completionTokensUnknown: 2,
        costKnown: 22,
        costUnknown: 2,
      }),
    )
    expect(rows.map((row) => row.label)).toEqual(['Turns', 'Hits', 'Misses', 'Avoided', 'Calls'])
    expect(rows.some((row) => /unknown/i.test(row.value))).toBe(false)
    expect(rows.some((row) => row.value === '22')).toBe(false)
  })

  test('omits token and cost rows when there were no inference calls', () => {
    const rows = ledgerRows(metrics({ promptTokens: 0, completionTokens: 0, costUsd: 0 }))
    expect(rows.map((row) => row.label)).toEqual(['Turns', 'Hits', 'Misses', 'Avoided', 'Calls'])
  })

  test('paints complete token and cost totals, never a receipt count', () => {
    const rows = ledgerRows(
      metrics({
        turns: 3,
        hits: 1,
        misses: 2,
        inferenceAvoided: 1,
        inferenceCalls: 2,
        promptTokens: 40,
        completionTokens: 12,
        costUsd: 0.0012,
        promptTokensKnown: 2,
        promptTokensUnknown: 0,
        completionTokensKnown: 2,
        completionTokensUnknown: 0,
        costKnown: 2,
        costUnknown: 0,
      }),
    )
    expect(rows).toContainEqual({ label: 'Prompt tokens', value: '40' })
    expect(rows).toContainEqual({ label: 'Completion tokens', value: '12' })
    expect(rows.find((row) => row.label === 'Cost')?.value).toMatch(/^\$/)
    expect(rows.find((row) => row.label === 'Cost')?.value).not.toBe('2')
  })
})
