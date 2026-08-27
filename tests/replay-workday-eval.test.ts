import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  INTERPRETATION,
  MISS_COST_USD,
  PRIMARY_NOVEL_RATE,
  TURN_COUNT,
  WINDOW,
  WORKDAY_EVAL_SEED,
  mixFor,
  planWorkdayTurns,
  runWorkdayEval,
} from '../scripts/replay-workday-eval.ts'

describe('workday saturation eval', () => {
  test('empty start, first-look misses, later paraphrase of that finding hits, late window beats early, falseHitRate is 0, no live sqlite', async () => {
    const report = await runWorkdayEval({
      storePath: join(tmpdir(), `automaton-workday-eval-test-${Date.now()}.sqlite`),
      dest: null,
      specDest: null,
      seed: WORKDAY_EVAL_SEED,
      novelRate: PRIMARY_NOVEL_RATE,
    })

    expect(report.summary.turns).toBe(TURN_COUNT)
    expect(report.turns).toHaveLength(TURN_COUNT)
    expect(report.series).toHaveLength(TURN_COUNT)
    expect(report.workload.seed).toBe(WORKDAY_EVAL_SEED)
    expect(report.workload.novelRate).toBe(PRIMARY_NOVEL_RATE)
    expect(report.store.liveHomeStore).toBe(false)
    expect(report.store.path).not.toMatch(/\.automaton\/staff\.sqlite$/)
    expect(report.summary.notes).toBe(INTERPRETATION)
    expect(report.gitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(JSON.stringify(report)).not.toMatch(/sk-or-test/)

    expect(report.turns[0]?.gold.reason).toBe('first-look')
    expect(report.turns[0]?.outcome).toBe('miss')
    expect(report.turns[0]?.inferenceAvoided).toBe(false)
    expect(report.turns[0]?.chatCalls).toBe(1)

    const firstLooks = report.turns.filter((row) => row.gold.reason === 'first-look')
    expect(firstLooks.length).toBe(mixFor(PRIMARY_NOVEL_RATE).firstLook)
    expect(firstLooks.every((row) => row.outcome === 'miss' && !row.falseHit)).toBe(true)
    expect(firstLooks.every((row) => row.gold.expect === 'miss')).toBe(true)

    const first = firstLooks[0]!
    const later = report.turns.find(
      (row) =>
        row.n > first.n &&
        row.gold.reason === 'revisit-paraphrase' &&
        row.gold.claimId === first.gold.claimId,
    )
    expect(later).toBeDefined()
    expect(later?.outcome).toBe('hit')
    expect(later?.inferenceAvoided).toBe(true)
    expect(later?.chatCalls).toBe(0)
    expect(later?.falseHit).toBe(false)

    const revisits = report.turns.filter((row) => row.gold.reason === 'revisit-paraphrase')
    expect(revisits.length).toBeGreaterThan(0)
    expect(revisits.every((row) => row.outcome === 'hit' && !row.falseHit)).toBe(true)

    expect(typeof report.summary.falseHitRate).toBe('number')
    expect(Number.isFinite(report.summary.falseHitRate)).toBe(true)
    expect(report.summary.falseHits).toBe(report.turns.filter((row) => row.falseHit).length)
    expect(report.summary.falseHitRate).toBe(report.summary.falseHits / report.summary.turns)
    expect(report.summary.falseHitRate).toBe(0)
    expect(report.summary.staleHitRate).toBe(0)
    expect(report.summary.costUsd).toBeCloseTo(report.summary.inferenceCalls * MISS_COST_USD, 10)
    expect(report.summary.avoidance).toBe(report.summary.inferenceAvoided / report.summary.turns)

    expect(report.windows.early.turns).toBe(WINDOW)
    expect(report.windows.late.turns).toBe(WINDOW)
    expect(report.windows.late.avoidance).toBeGreaterThan(report.windows.early.avoidance)
    expect(report.series[0]?.cumulativeAvoidance).toBe(0)
    expect(report.series.at(-1)?.cumulativeAvoidance).toBe(report.summary.avoidance)
  }, 60_000)

  test('planned mix is seeded, morning-weighted, interleaved, and about 5% first-looks', () => {
    const planned = planWorkdayTurns(WORKDAY_EVAL_SEED, PRIMARY_NOVEL_RATE)
    expect(planned).toHaveLength(TURN_COUNT)
    const mix = mixFor(PRIMARY_NOVEL_RATE)
    expect(mix.novelRate).toBe(0.05)
    expect(mix.firstLook).toBe(Math.round(TURN_COUNT * 0.05))
    const reasons = planned.map((row) => row.gold.reason)
    expect(reasons.filter((r) => r === 'first-look')).toHaveLength(mix.firstLook)
    expect(reasons.filter((r) => r === 'revisit-paraphrase')).toHaveLength(mix.revisitParaphrase)
    expect(reasons.filter((r) => r === 'followup')).toHaveLength(mix.followup)
    expect(reasons.filter((r) => r === 'unrelated')).toHaveLength(mix.unrelated)
    expect(new Set(reasons)).toEqual(new Set(['first-look', 'revisit-paraphrase', 'followup', 'unrelated']))

    expect(planned[0]?.gold.reason).toBe('first-look')
    const firstRevisit = reasons.findIndex((r) => r === 'revisit-paraphrase')
    const lastFirst = reasons.lastIndexOf('first-look')
    expect(firstRevisit).toBeGreaterThan(0)
    expect(lastFirst).toBeGreaterThan(firstRevisit)
    expect(lastFirst).toBeLessThan(TURN_COUNT - WINDOW)

    const queries = planned.map((row) => row.query)
    expect(planWorkdayTurns(WORKDAY_EVAL_SEED, PRIMARY_NOVEL_RATE).map((row) => row.query).join('\n')).toBe(
      queries.join('\n'),
    )
    expect(new Set(queries).size).toBeGreaterThan(40)
  })
})
