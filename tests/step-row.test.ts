import { describe, expect, test } from 'bun:test'
import {
  PRODUCT_VERBS,
  foldJobTraces,
  foldStepsByVerb,
  productVerb,
  stepRow,
  tracesFromJob,
} from '../src/chrome/step-row'

describe('step row + verb fold', () => {
  test('product verbs only; stringy rows; fold by verb', () => {
    expect(PRODUCT_VERBS).toEqual(['analyze', 'implement', 'shell', 'land', 'ship'])
    expect(productVerb('box-shell')).toBe('shell')
    expect(productVerb('promote')).toBe('land')
    expect(stepRow('implement', 'composer grow')).toBe('implement composer grow')
    expect(stepRow('analyze')).toBe('analyze')
    const folded = foldStepsByVerb([
      { verb: 'analyze', detail: 'read staff.md' },
      { verb: 'analyze', detail: 'read jobs.md' },
      { verb: 'implement', detail: 'wire picker' },
    ])
    expect(folded).toHaveLength(2)
    expect(folded[0]?.verb).toBe('analyze')
    expect(folded[0]?.count).toBe(2)
    expect(folded[0]?.detail).toBe('2 analyze')
    expect(folded[1]?.detail).toBe('wire picker')
    const job = tracesFromJob({
      kind: 'promote',
      goal: 'land dest',
      lastNote: 'Still running.',
      evidence: ['checks green'],
    })
    expect(job.map((row) => row.verb)).toEqual(['land', 'land'])
    expect(foldJobTraces([{ kind: 'analyze', goal: 'look at the stack' }])[0]?.verb).toBe('analyze')
    expect(stepRow('composerAgent', 'nope')).not.toContain('cursor')
  })
})
