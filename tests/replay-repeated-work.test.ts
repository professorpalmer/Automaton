import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runRepeatedWorkReplay,
  SESSION_RATE_NOTE,
} from '../scripts/replay-repeated-work.ts'

describe('repeated-work replay', () => {
  test('summary is 19/20 avoided on the real mouth path', async () => {
    const report = await runRepeatedWorkReplay({
      storePath: join(tmpdir(), `automaton-repeated-work-test-${Date.now()}.sqlite`),
      dest: null,
    })
    expect(report.summary.turns).toBe(20)
    expect(report.summary.misses).toBe(1)
    expect(report.summary.hits).toBe(19)
    expect(report.summary.inferenceAvoided).toBe(19)
    expect(report.summary.inferenceCalls).toBe(1)
    expect(report.summary.chatCalls).toBe(1)
    expect(report.summary.avoidedOverTotal).toBe(0.95)
    expect(report.turns).toHaveLength(20)
    expect(report.turns[0]?.outcome).toBe('miss')
    expect(report.turns[0]?.inferenceAvoided).toBe(false)
    expect(report.turns[0]?.chatCalls).toBe(1)
    expect(report.turns.slice(1).every((row) => row.outcome === 'hit' && row.inferenceAvoided && row.chatCalls === 0)).toBe(true)
    expect(report.store.liveHomeStore).toBe(false)
    expect(report.store.path).not.toMatch(/\.automaton\/staff\.sqlite$/)
    expect(report.workload.sessionRateNote).toBe(SESSION_RATE_NOTE)
    expect(report.gitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(report.capturedAt).toMatch(/Z$/)
    expect(JSON.stringify(report)).not.toMatch(/sk-or-test/)
  })
})
