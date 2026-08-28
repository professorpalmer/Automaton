import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import { mkdirSync, rmSync } from 'node:fs'
import {
  DEFAULT_MOUTH_MODEL,
  INTRO_MOUTH_MODEL,
  ensureMouth,
  mouthFailSpeak,
  parseOpenRouterUsage,
  resetMouthForTests,
} from '../src/runtime/mouth.ts'
import { INTRO_CUE, introFallback } from '../src/runtime/working-set.ts'
import { markIntroPlayedAt, readProfile, writeProfile } from '../src/runtime/profile.ts'
import { openStaffStore } from '../src/runtime/store.ts'
import { completeJob, completeMouth, maybeIntro, pendingMouthTurns, send } from '../src/session'

describe('mouth sidecar', () => {
  test('stored finding answers without calling OpenRouter', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
    })
    const before = store.listClaims().length
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'what did Kernel find about ledger replay')
    const turn = pendingMouthTurns(session)[0]
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'should not run'
      },
    )
    expect(calls).toBe(0)
    expect(spoken).toBe('The ledger replay is deterministic.')
    expect(store.listClaims()).toHaveLength(before)
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.outcome).toBe('hit')
    expect(receipt?.inferenceAvoided).toBe(true)
    expect(receipt?.inferenceAttempted).toBe(false)
    expect(receipt?.promptTokens).toBe(0)
    expect(receipt?.completionTokens).toBe(0)
    expect(receipt?.costUsd).toBe(0)
    expect(receipt?.status).toBe('complete')
    expect(receipt?.model).toBeNull()
    const ledger = store.metrics()
    expect(ledger.inferenceAvoided).toBe(1)
    expect(ledger.inferenceCalls).toBe(0)
  })

  test('live check does not speak a stored issue claim', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-live-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Issue #107 is still open on Puppetmaster.',
      source: 'job',
      jobId: 'job_107',
      artifactKind: 'analyze',
      freshness: 'fresh',
    })
    const before = store.listClaims().length
    const agents = staffWithSisters()
    const live = 'check Puppetmaster and Marionette for prs or open issues'
    const session = {
      agents,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(agents),
      jobs: [],
      pendingFanout: null,
    }
    session.threads.staff.items = [
      { kind: 'msg', id: 'item_live', from: 'user', agentId: 'staff', text: live },
    ]
    session.threads.staff.mouth = 'answer'
    let spoken = ''
    let calls = 0
    let packed: { role: string; content: unknown }[] = []
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async (messages) => {
        calls += 1
        packed = messages
        return 'Looking at the repos now.'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(spoken).toBe('Looking at the repos now.')
    expect(spoken).not.toContain('#107')
    expect(JSON.stringify(packed)).not.toContain('Recalled claims')
    expect(JSON.stringify(packed)).not.toContain('Issue #107')
    expect(store.listClaims()).toHaveLength(before)
  })

  test('name question spends a mouth call, not a stored claim', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-chat-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'Staff. I coordinate Kernel and Research.'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(spoken).not.toMatch(/I can dispatch/)
    expect(spoken).toBe('Staff. I coordinate Kernel and Research.')
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.outcome).toBe('miss')
    expect(receipt?.inferenceAvoided).toBe(false)
    expect(receipt?.inferenceAttempted).toBe(true)
    expect(receipt?.model).toBe(DEFAULT_MOUTH_MODEL)
    expect(receipt?.promptTokens).toBeNull()
    expect(receipt?.completionTokens).toBeNull()
    expect(receipt?.costUsd).toBeNull()
    expect(receipt?.status).toBe('complete')
    const ledger = store.metrics()
    expect(ledger.inferenceCalls).toBe(1)
    expect(ledger.promptTokens).toBeNull()
    expect(ledger.promptTokensUnknown).toBe(1)
  })

  test('miss receipt keeps provided usage', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-usage-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    await ensureMouth(
      session,
      store,
      {
        onComplete: () => undefined,
        onFail: () => undefined,
      },
      async () => ({
        text: 'Staff.',
        usage: { promptTokens: 11, completionTokens: 4, costUsd: 0.0002 },
      }),
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.model).toBe(DEFAULT_MOUTH_MODEL)
    expect(receipt?.promptTokens).toBe(11)
    expect(receipt?.completionTokens).toBe(4)
    expect(receipt?.costUsd).toBe(0.0002)
    expect(receipt?.inferenceAvoided).toBe(false)
    expect(receipt?.inferenceAttempted).toBe(true)
  })

  test('401 on the first key tries the next distinct key', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-auth-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    const seen: string[] = []
    let spoken = ''
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async (_messages, key, model) => {
        seen.push(`${key}:${model}`)
        if (key === 'sk-or-dead') throw new Error('openrouter 401')
        return 'Staff.'
      },
      [
        { key: 'sk-or-dead', source: 'env' },
        { key: 'sk-or-live', source: 'marionette' },
      ],
    )
    expect(seen).toEqual([`sk-or-dead:${DEFAULT_MOUTH_MODEL}`, `sk-or-live:${DEFAULT_MOUTH_MODEL}`])
    expect(spoken).toBe('Staff.')
    expect(store.receipt(turn.itemId)?.inferenceAttempted).toBe(true)
  })

  test('429 retries then speaks; exhausted 429 is not a reach failure', async () => {
    expect(mouthFailSpeak(new Error('openrouter 429'))).toBe('OpenRouter rate limited. Try again.')
    expect(mouthFailSpeak(new Error('empty mouth'))).toBe('The model returned no text.')
    expect(mouthFailSpeak(new Error('openrouter 404'))).toBe('OpenRouter rejected this model.')
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-429-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'research' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Are you around?')
    const turn = pendingMouthTurns(session)[0]
    let hits = 0
    let spoken = ''
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        hits += 1
        if (hits === 1) throw new Error('openrouter 429')
        return 'Research here.'
      },
      [{ key: 'sk-or-live', source: 'automaton' }],
    )
    expect(hits).toBe(2)
    expect(spoken).toBe('Research here.')
    expect(store.receipt(turn.itemId)?.status).toBe('complete')
  })

  test('missing key does not mark inference attempted', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-nokey-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'should not run'
      },
      [],
    )
    expect(calls).toBe(0)
    expect(spoken).toBe('Need an OpenRouter key.')
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.outcome).toBe('miss')
    expect(receipt?.inferenceAvoided).toBe(false)
    expect(receipt?.inferenceAttempted).toBe(false)
    expect(receipt?.status).toBe('failed')
    expect(store.metrics().inferenceCalls).toBe(0)
  })

  test('failed model call still marks inference attempted', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-fail-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    await ensureMouth(
      session,
      store,
      {
        onComplete: () => undefined,
        onFail: () => undefined,
      },
      async () => {
        throw new Error('openrouter 500')
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.outcome).toBe('miss')
    expect(receipt?.inferenceAttempted).toBe(true)
    expect(receipt?.inferenceAvoided).toBe(false)
    expect(receipt?.status).toBe('failed')
    expect(receipt?.model).toBe(DEFAULT_MOUTH_MODEL)
    expect(store.metrics().inferenceCalls).toBe(1)
    expect(store.metrics().promptTokens).toBeNull()
  })

  test('auth-rejected keys still mark inference attempted', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-authfail-${Date.now()}.sqlite`))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    const turn = pendingMouthTurns(session)[0]
    let spoken = ''
    await ensureMouth(
      session,
      store,
      {
        onComplete: () => undefined,
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        throw new Error('openrouter 401')
      },
      [{ key: 'sk-or-dead', source: 'env' }],
    )
    expect(spoken).toBe('OpenRouter key was rejected.')
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.inferenceAttempted).toBe(true)
    expect(receipt?.status).toBe('failed')
    expect(store.metrics().inferenceCalls).toBe(1)
  })

  test('vague recall of an arbitrary recent claim misses', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-arbitrary-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'what did you find')
    const turn = pendingMouthTurns(session)[0]
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'Staff. I coordinate Kernel and Research.'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(spoken).not.toBe('The ledger replay is deterministic.')
    const receipt = store.receipt(turn.itemId)
    expect(receipt?.outcome).toBe('miss')
    expect(receipt?.inferenceAvoided).toBe(false)
    expect(receipt?.inferenceAttempted).toBe(true)
  })

  test('stale claim is not spoken as a hit', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-stale-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
      taskKey: 'kernel:analyze:ledger replay',
      artifactKind: 'analyze',
      freshness: 'stale',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'what did Kernel find about ledger replay')
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'should infer'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(spoken).toBe('should infer')
  })

  test('implement claim is not spoken as an analyze finding', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-implement-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
      taskKey: 'kernel:implement:ledger replay',
      artifactKind: 'implement',
      freshness: 'fresh',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'what did Kernel find about ledger replay')
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'should infer'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(spoken).toBe('should infer')
  })

  test('coordinator assess sees the sister line and skips query-first', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-assess-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_assess',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Can you ping research?')
    session = completeMouth(session, 'research', "I'm here to assist you. How can I help?")
    const turn = pendingMouthTurns(session)[0]
    expect(turn?.agentId).toBe('staff')
    expect(turn?.mode).toBe('assess')
    let spoken = ''
    let calls = 0
    let lastUser = ''
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async (messages) => {
        calls += 1
        const last = messages.at(-1)
        lastUser = typeof last?.content === 'string' ? last.content : ''
        return 'Research is online. What would you like the research automaton to run?'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(lastUser).toContain('Research answered:')
    expect(lastUser).toContain("I'm here to assist you. How can I help?")
    expect(spoken).toBe('Research is online. What would you like the research automaton to run?')
    expect(spoken).not.toBe('The ledger replay is deterministic.')
  })

  test('assess of a sister PR answer is not treated as a live-check', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-assess-pr-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Issue #107 is still open on Puppetmaster.',
      source: 'job',
      jobId: 'job_107',
      artifactKind: 'analyze',
      freshness: 'fresh',
    })
    const marionette = {
      id: 'agent_mn',
      name: 'Marionette',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const agents = [...staffWithSisters(), marionette]
    let session = {
      agents,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(agents),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'check Marionette for prs or open issues')
    const jobId = session.jobs[0]?.id
    expect(jobId).toBeTruthy()
    session = completeJob(session, jobId!, 'Marionette has 2 open PRs.')
    const turn = pendingMouthTurns(session)[0]
    expect(turn?.mode).toBe('assess')
    expect(turn?.userText).toContain('Marionette answered:')
    expect(turn?.userText).toContain('open PRs')
    let spoken = ''
    let packed: { role: string; content: unknown }[] = []
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async (messages) => {
        packed = messages
        return 'Marionette currently has two open pull requests.'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(spoken).toBe('Marionette currently has two open pull requests.')
    const blob = JSON.stringify(packed)
    expect(blob).not.toContain('A look is already booked')
    expect(blob).toContain('Marionette answered:')
    expect(blob).toContain('Marionette has 2 open PRs.')
  })

  test('OpenRouter usage stays unknown when the provider omits it', () => {
    expect(parseOpenRouterUsage({})).toEqual({
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
    })
    expect(
      parseOpenRouterUsage({
        usage: { prompt_tokens: 9, completion_tokens: 3, cost: 0.001 },
      }),
    ).toEqual({
      promptTokens: 9,
      completionTokens: 3,
      costUsd: 0.001,
    })
  })

  test('intro mouth uses the hidden cue, cheap model, and no claims', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-intro-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'staff',
      text: 'should not be recalled for intro',
      source: 'mouth',
    })
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = maybeIntro(session, 'staff', null)
    let spoken = ''
    let calls = 0
    let modelUsed = ''
    let lastMessages: { role: string; content: unknown }[] = []
    await ensureMouth(
      session,
      store,
      {
        onComplete: (_agentId, text) => {
          spoken = text
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async (messages, _key, model) => {
        calls += 1
        modelUsed = model
        lastMessages = messages
        return 'Chief of Staff. I own this computer and dispatch work.'
      },
      [{ key: 'sk-or-test', source: 'automaton' }],
    )
    expect(calls).toBe(1)
    expect(modelUsed).toBe(INTRO_MOUTH_MODEL)
    expect(spoken).toBe('Chief of Staff. I own this computer and dispatch work.')
    expect(lastMessages).toHaveLength(2)
    expect(lastMessages[1]?.role).toBe('user')
    expect(String(lastMessages[1]?.content)).toContain(INTRO_CUE)
    expect(JSON.stringify(lastMessages)).not.toContain('should not be recalled for intro')
    session = completeMouth(session, 'staff', spoken)
    expect(session.threads.staff.items.filter((item) => item.kind === 'msg')).toHaveLength(1)
  })

  test('intro without a key uses the name-title template and introPlayedAt sticks', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const home = join(tmpdir(), `automaton-mouth-intro-home-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const prev = process.env.AUTOMATON_HOME
    process.env.AUTOMATON_HOME = home
    writeProfile(
      {
        id: 'staff',
        name: 'Chief of Staff',
        title: 'Coordinator',
        description: 'Owns the computer.',
        rules: '',
        kit: 'coordinator',
        avatarShape: 'blob',
        avatarColor: 'staff',
        namedBy: 'app',
        skillIds: [],
        notifyOnUpdates: true,
        hiddenFromRail: false,
        createdAt: '1970-01-01T00:00:00.000Z',
        homeRepo: '',
        homePath: '',
        introPlayedAt: null,
      },
      home,
    )
    const store = openStaffStore(join(home, 'staff.sqlite'))
    let session = {
      agents: staffWithSisters(),
      activeAgentId: 'staff' as const,
      threads: emptyThreads(staffWithSisters()),
      jobs: [],
      pendingFanout: null,
    }
    session = maybeIntro(session, 'staff', readProfile('staff', home)?.introPlayedAt ?? null)
    let spoken = ''
    let calls = 0
    await ensureMouth(
      session,
      store,
      {
        onComplete: (agentId, text) => {
          spoken = text
          markIntroPlayedAt(agentId, home)
        },
        onFail: (_agentId, text) => {
          spoken = text
        },
      },
      async () => {
        calls += 1
        return 'should not run'
      },
      [],
    )
    expect(calls).toBe(0)
    expect(spoken).toBe(introFallback({ id: 'staff', name: 'Chief of Staff', title: 'Coordinator', description: '', color: '', hidden: false }))
    session = completeMouth(session, 'staff', spoken)
    expect(readProfile('staff', home)?.introPlayedAt).toBeTruthy()
    const played = readProfile('staff', home)?.introPlayedAt ?? null
    const again = maybeIntro(session, 'staff', played)
    expect(again.threads.staff.mouth).toBe('idle')
    resetMouthForTests()
    await ensureMouth(
      again,
      store,
      {
        onComplete: () => {
          throw new Error('second intro')
        },
        onFail: () => {
          throw new Error('second intro fail')
        },
      },
      async () => 'nope',
      [],
    )
    if (prev === undefined) delete process.env.AUTOMATON_HOME
    else process.env.AUTOMATON_HOME = prev
    rmSync(home, { recursive: true, force: true })
  })
})
