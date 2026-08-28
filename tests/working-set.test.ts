import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests, SISTER_AGENTS, staffWithSisters } from '../src/domain'
import { looksLikeInspect, looksLikeLiveCheck, looksLikeRepoAsk } from '../src/domain'
import {
  buildWorkingSet,
  claimTaskKey,
  INTRO_CUE,
  introFallback,
  looksLikeRecallRequest,
  queryFirst,
  TAIL,
} from '../src/runtime/working-set.ts'

describe('mouth working set', () => {
  test('live check misses queryFirst even when a numbered issue claim exists', () => {
    const issue = {
      ownerAgentId: 'kernel',
      text: 'Issue #107 is still open on Puppetmaster.',
      taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'open issues' }),
      artifactKind: 'analyze' as const,
      freshness: 'fresh' as const,
    }
    const check = 'check Puppetmaster and Marionette for prs or open issues'
    expect(looksLikeLiveCheck(check)).toBe(true)
    expect(looksLikeRecallRequest(check)).toBe(false)
    expect(queryFirst(check, [issue])).toBeNull()
    expect(looksLikeRepoAsk('do we have any PRs or open issues?')).toBe(true)
    expect(queryFirst('do we have any PRs or open issues?', [issue])).toBeNull()
    expect(looksLikeInspect('check the ledger replay in Automaton staff.')).toBe(true)
    expect(queryFirst('check the ledger replay in Automaton staff.', [issue])).toBeNull()
  })

  test('live-check working set drops claim texts and does not tell the mouth to use them', () => {
    resetIdsForTests()
    const thread = emptyThreads(DEFAULT_AGENTS).staff
    thread.items = [
      {
        kind: 'msg',
        id: 'item_1',
        from: 'user',
        agentId: 'staff',
        text: 'check Puppetmaster and Marionette for prs or open issues',
      },
    ]
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread,
      claims: [{ ownerAgentId: 'kernel', text: 'Issue #107 is still open on Puppetmaster.' }],
      kit: 'coordinator',
      roster: staffWithSisters(),
      projects: [],
      query: 'check Puppetmaster and Marionette for prs or open issues',
    })
    const blob = JSON.stringify(messages)
    expect(blob).not.toContain('Recalled claims')
    expect(blob).not.toContain('Issue #107')
    expect(blob).not.toContain('If recalled claims answer the user')
    expect(String(messages[0]?.content)).toContain('A look is already booked')
    expect(String(messages[0]?.content)).toContain('Do not answer from memory or transcript about GitHub, PRs, or issues.')
  })

  test('query-first restates a stored claim with no inference', () => {
    expect(
      queryFirst('what did Kernel find', [
        { ownerAgentId: 'staff', text: 'I am Staff.' },
        { ownerAgentId: 'kernel', text: 'The ledger replay is deterministic.' },
      ]),
    ).toBe('The ledger replay is deterministic.')
    expect(looksLikeRecallRequest('what did Kernel find about ledger replay')).toBe(true)
    expect(looksLikeLiveCheck('what did Kernel find about ledger replay')).toBe(false)
    expect(queryFirst('Hello, what is your name?', [{ ownerAgentId: 'staff', text: 'x' }])).toBeNull()
    expect(
      queryFirst('what did Research find', [
        { ownerAgentId: 'kernel', text: 'The ledger replay is deterministic.' },
      ]),
    ).toBeNull()
  })

  test('queryFirst refuses arbitrary recent claim', () => {
    const recent = {
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      freshness: 'fresh' as const,
    }
    expect(queryFirst('what did you find', [recent])).toBeNull()
    expect(queryFirst("what's up", [recent])).toBeNull()
    expect(queryFirst('', [recent])).toBeNull()
  })

  test('queryFirst does not steal another mouth claim via a shared word', () => {
    const claims = [
      { ownerAgentId: 'kernel', text: 'The ledger replay is deterministic.', freshness: 'fresh' as const },
      { ownerAgentId: 'research', text: 'The ledger parser notes are complete.', freshness: 'fresh' as const },
    ]
    expect(queryFirst('what did Research find about parser', claims)).toBe(
      'The ledger parser notes are complete.',
    )
    expect(queryFirst('what did you find about ledger', claims)).toBeNull()
  })

  test('queryFirst refuses a stale claim', () => {
    expect(
      queryFirst('what did Kernel find about ledger replay', [
        {
          ownerAgentId: 'kernel',
          text: 'The ledger replay is deterministic.',
          taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'ledger replay' }),
          artifactKind: 'analyze',
          freshness: 'stale',
        },
      ]),
    ).toBeNull()
  })

  test('queryFirst does not treat implement prior as analyze reuse', () => {
    expect(
      queryFirst('what did Kernel find about ledger replay', [
        {
          ownerAgentId: 'kernel',
          text: 'The ledger replay is deterministic.',
          taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'implement', goal: 'ledger replay' }),
          artifactKind: 'implement',
          freshness: 'fresh',
        },
      ]),
    ).toBeNull()
  })

  test('queryFirst hits a matching task_key and misses a disagreed one', () => {
    const replayKey = claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'ledger replay' })
    expect(
      queryFirst('what did Kernel find about ledger replay', [
        {
          ownerAgentId: 'kernel',
          text: 'The ledger replay is deterministic.',
          taskKey: replayKey,
          artifactKind: 'analyze',
          freshness: 'fresh',
        },
      ]),
    ).toBe('The ledger replay is deterministic.')
    expect(
      queryFirst('what did Kernel find about ledger replay', [
        {
          ownerAgentId: 'kernel',
          text: 'The ledger replay is deterministic.',
          taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'parser' }),
          artifactKind: 'analyze',
          freshness: 'fresh',
        },
      ]),
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
      claims: [{ ownerAgentId: 'kernel', text: 'The ledger replay is deterministic.' }],
      projects: [],
    })
    const chat = messages.filter((row) => row.role !== 'system')
    expect(chat).toHaveLength(TAIL)
    expect(messages.some((row) => row.content.includes('Recalled claims'))).toBe(true)
    expect(messages.some((row) => row.content.includes('line 0'))).toBe(false)
  })

  test('standing rules join the system prompt', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread: emptyThreads(DEFAULT_AGENTS).staff,
      claims: [],
      rules: 'Never mention the sandbox.',
      projects: [],
    })
    expect(messages[0]?.content).toContain('Standing rules: Never mention the sandbox.')
  })

  test('coordinator kit injects roster and never refuses to inquire', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread: emptyThreads(DEFAULT_AGENTS).staff,
      claims: [],
      kit: 'coordinator',
      roster: staffWithSisters(),
      projects: [],
    })
    const prompt = String(messages[0]?.content)
    expect(prompt).toContain('head seat')
    expect(prompt).toContain('Roster: Chief of Staff (Coordinator), Kernel (Code), Research (Wiki / web).')
    expect(prompt).toContain('Every automaton shares')
    expect(prompt).not.toContain('Every mouth')
    expect(prompt).toContain('one local Docker Linux')
    expect(prompt).toContain('not another hypervisor')
    expect(prompt).toContain('Never anyrun')
    expect(prompt).toContain('Never tell the operator to ask Kernel for a VM')
    expect(prompt).toContain('already named')
    expect(prompt).toContain('do not offer to dispatch')
    expect(prompt).toContain('A GitHub issue or pull URL is work')
    expect(prompt).toContain('Do not parrot')
    expect(prompt).toContain('Never claim you navigated Chrome')
    expect(prompt).toContain('Never explain displays')
    expect(prompt).toContain('This Mac keeps git checkouts under ~/Projects.')
    expect(prompt).toContain('not the default subject')
    expect(prompt).not.toContain('one next step they can ask')
    expect(prompt).not.toContain('cannot make inquiries')
    expect(prompt).not.toContain('You never do Kernel implement')
  })

  test('mouth prompt is the machine harness, not Automaton-as-the-universe', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread: emptyThreads(DEFAULT_AGENTS).staff,
      claims: [],
      kit: 'coordinator',
      roster: staffWithSisters(),
      projects: [
        {
          name: 'Puppetmaster',
          path: '/tmp/Puppetmaster',
          keys: ['puppetmaster'],
        },
        {
          name: 'Marionette',
          path: '/tmp/marionette',
          keys: ['marionette'],
        },
      ],
    })
    const prompt = String(messages[0]?.content)
    expect(prompt).toContain('Puppetmaster at /tmp/Puppetmaster')
    expect(prompt).toContain('Marionette at /tmp/marionette')
    expect(prompt).toContain('not the default subject')
    expect(prompt).toContain('plane.json')
    expect(prompt).toContain('AUTOMATON_MODEL')
    expect(prompt).toContain('You do not read disk this turn')
  })

  test('seat model is a fact in the prompt, not an API scavenger hunt', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: SISTER_AGENTS[1],
      thread: emptyThreads(staffWithSisters()).research,
      claims: [],
      kit: 'lookup',
      model: 'openai/gpt-4o-mini',
      projects: [],
    })
    const prompt = String(messages[0]?.content)
    expect(prompt).toContain('OpenRouter model openai/gpt-4o-mini')
    expect(prompt).toContain('Do not tell them to check an API')
  })

  test('code kit with a home repo never points work at Automaton', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: { ...SISTER_AGENTS[0], name: 'Puppetmaster', title: 'example/Puppetmaster' },
      thread: emptyThreads(staffWithSisters()).kernel,
      claims: [],
      kit: 'code',
      homeRepo: 'example/Puppetmaster',
      projects: [],
    })
    const prompt = String(messages[0]?.content)
    expect(prompt).toContain('Your home is example/Puppetmaster.')
    expect(prompt).toContain('Do not ask for a repo path')
    expect(prompt).toContain('not Automaton')
  })

  test('intro working set is system plus a hidden first-open cue', () => {
    resetIdsForTests()
    const staff = DEFAULT_AGENTS[0]
    const messages = buildWorkingSet({
      agent: staff,
      thread: emptyThreads(DEFAULT_AGENTS).staff,
      claims: [{ ownerAgentId: 'staff', text: 'should not appear' }],
      kit: 'coordinator',
      roster: DEFAULT_AGENTS,
      intro: true,
      projects: [],
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages[1]?.content).toContain(INTRO_CUE)
    expect(messages[1]?.content).toContain('make more automata')
    expect(JSON.stringify(messages)).not.toContain('should not appear')
    expect(introFallback(staff)).toBe('Chief of Staff. Coordinator.')
  })
})
