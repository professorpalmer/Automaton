import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  INTERPRETATION,
  MISS_COST_USD,
  TOUGH_EVAL_SEED,
  planToughTurns,
  runToughEval,
} from '../scripts/replay-tough-eval.ts'

describe('tough recall eval', () => {
  test('stale never served, conflict does not pick a side, evolved revision does not serve old commit, unrelated misses, paraphrases can hit, falseHitRate is computed', async () => {
    const report = await runToughEval({
      storePath: join(tmpdir(), `automaton-tough-eval-test-${Date.now()}.sqlite`),
      dest: null,
      seed: TOUGH_EVAL_SEED,
    })

    expect(report.summary.turns).toBeGreaterThanOrEqual(300)
    expect(report.turns).toHaveLength(report.summary.turns)
    expect(report.workload.seed).toBe(TOUGH_EVAL_SEED)
    expect(report.store.liveHomeStore).toBe(false)
    expect(report.store.path).not.toMatch(/\.automaton\/staff\.sqlite$/)
    expect(report.summary.notes).toBe(INTERPRETATION)
    expect(report.workload.interpretation).toBe(INTERPRETATION)
    expect(report.gitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(JSON.stringify(report)).not.toMatch(/sk-or-test/)

    expect(typeof report.summary.falseHitRate).toBe('number')
    expect(Number.isFinite(report.summary.falseHitRate)).toBe(true)
    expect(report.summary.falseHitRate).toBeGreaterThanOrEqual(0)
    expect(report.summary.falseHitRate).toBeLessThanOrEqual(1)
    expect(report.summary.falseHits).toBe(report.turns.filter((row) => row.falseHit).length)
    expect(report.summary.falseHitRate).toBe(report.summary.falseHits / report.summary.turns)

    const stale = report.turns.filter((row) => row.gold.reason === 'stale')
    expect(stale.length).toBeGreaterThan(0)
    expect(stale.every((row) => row.outcome === 'miss')).toBe(true)
    expect(stale.every((row) => row.servedFreshness !== 'stale')).toBe(true)
    expect(stale.every((row) => !row.staleHit && !row.falseHit)).toBe(true)

    const conflict = report.turns.filter((row) => row.gold.reason === 'conflict')
    expect(conflict.length).toBeGreaterThan(0)
    expect(conflict.every((row) => row.outcome === 'miss')).toBe(true)
    expect(conflict.every((row) => !row.servedClaimId && !row.falseHit)).toBe(true)

    const evolved = report.turns.filter((row) => row.gold.reason === 'evolved-repo')
    expect(evolved.length).toBeGreaterThan(0)
    expect(evolved.every((row) => row.outcome === 'miss')).toBe(true)
    expect(
      evolved.every((row) => {
        if (!row.servedRevision || !row.gold.currentRevision) return true
        return row.servedRevision === row.gold.currentRevision
      }),
    ).toBe(true)
    expect(evolved.every((row) => !row.staleHit && !row.falseHit)).toBe(true)

    const unrelated = report.turns.filter((row) => row.gold.reason === 'unrelated')
    expect(unrelated.length).toBeGreaterThan(0)
    expect(unrelated.every((row) => row.outcome === 'miss')).toBe(true)
    expect(unrelated.every((row) => !row.falseHit)).toBe(true)

    const paraphrases = report.turns.filter((row) => row.gold.reason === 'paraphrase')
    expect(paraphrases.length).toBeGreaterThan(0)
    expect(paraphrases.some((row) => row.outcome === 'hit' && !row.falseHit)).toBe(true)
    expect(paraphrases.filter((row) => row.outcome === 'hit').every((row) => !row.falseHit)).toBe(true)

    expect(report.summary.staleHitRate).toBe(0)
    expect(report.summary.falseHitRate).toBe(0)
    expect(report.summary.costUsd).toBeCloseTo(report.summary.inferenceCalls * MISS_COST_USD, 10)
    expect(report.summary.avoidance).toBe(report.summary.inferenceAvoided / report.summary.turns)
    expect(report.summary.avoidance).toBeLessThan(0.95)
  }, 30_000)

  test('planned mix is seeded, mixed, and not twenty identical recalls', () => {
    const planned = planToughTurns(TOUGH_EVAL_SEED)
    expect(planned.length).toBeGreaterThanOrEqual(300)
    const reasons = new Set(planned.map((row) => row.gold.reason))
    expect(reasons).toEqual(
      new Set(['paraphrase', 'followup', 'changed-req', 'evolved-repo', 'stale', 'conflict', 'unrelated']),
    )
    const queries = planned.map((row) => row.query)
    expect(new Set(queries).size).toBeGreaterThan(40)
    const longestRun = queries.reduce(
      (best, query, i) => {
        if (i === 0) return best
        const run = query === queries[i - 1] ? best.run + 1 : 1
        return { run, max: Math.max(best.max, run) }
      },
      { run: 1, max: 1 },
    )
    expect(longestRun.max).toBeLessThan(20)
    expect(planToughTurns(TOUGH_EVAL_SEED).map((row) => row.query).join('\n')).toBe(queries.join('\n'))
  })
})
