import { describe, expect, test } from 'bun:test'
import {
  composerEnterBusy,
  DEFAULT_AGENTS,
  emptyThreads,
  isMouthBusy,
  jobKindFor,
  looksLikeJob,
  mentionedAgentIds,
  needsFanoutConfirm,
  resetIdsForTests,
  visibleAgents,
} from '../src/domain'

describe('mouth vs job', () => {
  test('working is not mouth-busy and does not steal Enter', () => {
    expect(isMouthBusy('working')).toBe(false)
    expect(composerEnterBusy('working')).toBe(false)
    expect(composerEnterBusy('idle')).toBe(false)
    expect(composerEnterBusy('must_first')).toBe(true)
  })

  test('hidden agents stay out of the rail', () => {
    const agents = DEFAULT_AGENTS.map((agent) =>
      agent.id === 'research' ? { ...agent, hidden: true } : agent,
    )
    expect(visibleAgents(agents).map((a) => a.id)).toEqual(['staff', 'kernel'])
  })

  test('fan-out confirm is 3+ mentions', () => {
    expect(needsFanoutConfirm(['staff'])).toBe(false)
    expect(needsFanoutConfirm(['staff', 'kernel', 'research'])).toBe(true)
    expect(mentionedAgentIds('Kernel, the insert breaks undo.', DEFAULT_AGENTS)).toEqual([])
    expect(mentionedAgentIds('@Kernel @Research @Staff look', DEFAULT_AGENTS)).toEqual([
      'kernel',
      'research',
      'staff',
    ])
  })

  test('job heuristic is not every short chat', () => {
    expect(looksLikeJob('hey')).toBe(false)
    expect(looksLikeJob('Kernel, the mention insert breaks undo on the composer.')).toBe(true)
    expect(jobKindFor('staff', 'Kernel, the mention insert breaks undo on the composer.')).toBeNull()
    expect(jobKindFor('kernel', 'Kernel, the mention insert breaks undo on the composer.')).toBe(
      'implement',
    )
    expect(jobKindFor('research', 'Look up why Send stays Send in Automaton staff.')).toBe(
      'analyze',
    )
    expect(jobKindFor('kernel', 'Look up why Send stays Send in Automaton staff.')).toBe('analyze')
  })

  test('threads are per agent', () => {
    resetIdsForTests()
    const threads = emptyThreads(DEFAULT_AGENTS)
    expect(Object.keys(threads).sort()).toEqual(['kernel', 'research', 'staff'])
    expect(threads.staff.mouth).toBe('idle')
  })
})
