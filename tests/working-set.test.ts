import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import { buildWorkingSet, queryFirst, TAIL } from '../src/runtime/working-set.ts'

describe('mouth working set', () => {
  test('query-first restates a stored claim with no inference', () => {
    expect(
      queryFirst('what did Kernel find', [
        { ownerAgentId: 'staff', text: 'I am Staff.' },
        { ownerAgentId: 'kernel', text: 'Insert undo is restored.' },
      ]),
    ).toBe('Insert undo is restored.')
    expect(queryFirst('Hello, what is your name?', [{ ownerAgentId: 'staff', text: 'x' }])).toBeNull()
    expect(
      queryFirst('what did Research find', [{ ownerAgentId: 'kernel', text: 'Insert undo is restored.' }]),
    ).toBeNull()
  })

  test('working set is a tail plus recalled claims, not the whole thread', () => {
    resetIdsForTests()
    const thread = emptyThreads(DEFAULT_AGENTS).staff
    const items = []
    for (let i = 0; i < 20; i += 1) {
      items.push({
        kind: 'msg' as const,
        id: `item_${i}`,
        from: i % 2 === 0 ? ('user' as const) : ('agent' as const),
        agentId: 'staff',
        text: `line ${i}`,
      })
    }
    thread.items = items
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread,
      claims: [{ ownerAgentId: 'kernel', text: 'Insert undo is restored.' }],
    })
    const chat = messages.filter((row) => row.role !== 'system')
    expect(chat).toHaveLength(TAIL)
    expect(messages.some((row) => row.content.includes('Recalled claims'))).toBe(true)
    expect(messages.some((row) => row.content.includes('line 0'))).toBe(false)
  })
})
