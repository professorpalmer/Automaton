import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import {
  DEFAULT_MOUTH_MODEL,
  ensureMouth,
  parseOpenRouterUsage,
  resetMouthForTests,
} from '../src/runtime/mouth.ts'
import { openStaffStore } from '../src/runtime/store.ts'
import { pendingMouthTurns, send } from '../src/session'

describe('mouth sidecar', () => {
  test('stored finding answers without calling OpenRouter', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Insert undo is restored.',
      source: 'job',
      jobId: 'job_1',
    })
    const before = store.listClaims().length
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'what did Kernel find about insert undo')
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
    expect(spoken).toBe('Insert undo is restored.')
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

  test('name question spends a mouth call, not a stored claim', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-chat-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Insert undo is restored.',
      source: 'job',
      jobId: 'job_1',
    })
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
      async (_messages, key) => {
        seen.push(key)
        if (key === 'sk-or-dead') throw new Error('openrouter 401')
        return 'Staff.'
      },
      [
        { key: 'sk-or-dead', source: 'env' },
        { key: 'sk-or-live', source: 'marionette' },
      ],
    )
    expect(seen).toEqual(['sk-or-dead', 'sk-or-live'])
    expect(spoken).toBe('Staff.')
    expect(store.receipt(turn.itemId)?.inferenceAttempted).toBe(true)
  })

  test('missing key does not mark inference attempted', async () => {
    resetIdsForTests()
    resetMouthForTests()
    const store = openStaffStore(join(tmpdir(), `automaton-mouth-nokey-${Date.now()}.sqlite`))
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
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
})
