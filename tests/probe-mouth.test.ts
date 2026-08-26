import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_MOUTH_MODEL } from '../src/runtime/mouth.ts'
import { isMouthProbeReport, redactSecrets, runMouthProbe } from '../scripts/probe-mouth.ts'

describe('mouth probe report', () => {
  test('seeded recall is zero-call and the artifact shape has no key', async () => {
    const report = await runMouthProbe({
      storePath: join(tmpdir(), `automaton-probe-shape-${Date.now()}.sqlite`),
      chat: async () => ({
        text: 'Staff. I coordinate Kernel and Research.',
        usage: { promptTokens: 8, completionTokens: 6, costUsd: 0.0001 },
      }),
      keys: [{ key: 'sk-or-test-secret', source: 'automaton' }],
    })
    expect(isMouthProbeReport(report)).toBe(true)
    expect(report.recall.calls).toBe(0)
    expect(report.recall.outcome).toBe('hit')
    expect(report.recall.inferenceAvoided).toBe(true)
    expect(report.recall.inferenceAttempted).toBe(false)
    expect(report.recall.promptTokens).toBe(0)
    expect(report.recall.costUsd).toBe(0)
    expect(report.recall.spoken).toBe('The ledger replay is deterministic.')
    expect(report.inference.spoken).not.toBe('The ledger replay is deterministic.')
    expect(report.inference.calls).toBe(1)
    expect(report.inference.outcome).toBe('miss')
    expect(report.inference.inferenceAttempted).toBe(true)
    expect(report.inference.model).toBe(DEFAULT_MOUTH_MODEL)
    expect(report.inference.promptTokens).toBe(8)
    expect(report.inference.completionTokens).toBe(6)
    expect(report.inference.costUsd).toBe(0.0001)
    expect(report.ledger.turns).toBe(2)
    expect(report.ledger.hits).toBe(1)
    expect(report.ledger.misses).toBe(1)
    expect(report.ledger.inferenceAvoided).toBe(1)
    expect(report.ledger.inferenceCalls).toBe(1)
    expect(report.ledger.promptTokens).toBe(8)
    expect(report.ledger.completionTokens).toBe(6)
    expect(report.ledger.costUsd).toBe(0.0001)
    expect(report.ledger.promptTokensUnknown).toBe(0)
    const raw = JSON.stringify(report)
    expect(raw).not.toMatch(/sk-or-test-secret/)
    expect(raw).not.toMatch(/"key"/)
    expect(redactSecrets('prefix sk-or-test-secret suffix')).toBe('prefix [redacted] suffix')
  })
})
