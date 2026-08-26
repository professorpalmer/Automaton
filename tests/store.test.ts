import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_AGENTS, emptyThreads, peekIdSeq, resetIdsForTests } from '../src/domain'
import { openStaffStore, type TurnReceipt } from '../src/runtime/store.ts'
import { send } from '../src/session'

describe('staff sqlite store', () => {
  test('session survives reload and claims recall without a model', () => {
    resetIdsForTests()
    const path = join(tmpdir(), `automaton-store-${Date.now()}.sqlite`)
    const store = openStaffStore(path)
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'Hello, what is your name?')
    store.save(session)
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Insert undo is restored.',
      source: 'job',
      jobId: 'job_roundtrip',
    })
    resetIdsForTests()
    const loaded = openStaffStore(path)
    expect(loaded.load()?.threads.staff.items).toHaveLength(1)
    expect(peekIdSeq()).toBeGreaterThan(0)
    const claimed = loaded.recall('Insert undo')
    expect(claimed[0]?.text).toBe('Insert undo is restored.')
    expect(claimed[0]?.id).toBeTruthy()
    expect(claimed[0]?.source).toBe('job')
    expect(claimed[0]?.jobId).toBe('job_roundtrip')
  })

  test('legacy claims migrate and round-trip with identity', () => {
    const path = join(tmpdir(), `automaton-store-migrate-${Date.now()}.sqlite`)
    const db = new Database(path)
    db.exec(`
      CREATE TABLE claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    db.run('INSERT INTO claims (owner_agent_id, text, created_at) VALUES (?, ?, ?)', [
      'kernel',
      'Insert undo is restored.',
      '2026-01-01T00:00:00.000Z',
    ])
    db.close()

    const store = openStaffStore(path)
    const rows = store.listClaims()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBeTruthy()
    expect(rows[0]?.ownerAgentId).toBe('kernel')
    expect(rows[0]?.text).toBe('Insert undo is restored.')
    expect(rows[0]?.source).toBe('mouth')
    expect(rows[0]?.jobId).toBeUndefined()

    store.remember({
      ownerAgentId: 'research',
      text: 'Looked up the pin.',
      source: 'job',
      jobId: 'job_abc',
    })
    const again = openStaffStore(path).listClaims()
    expect(again).toHaveLength(2)
    expect(again.find((row) => row.jobId === 'job_abc')?.source).toBe('job')
    expect(again.find((row) => row.text === 'Insert undo is restored.')?.id).toBe(rows[0]?.id)
  })

  test('relevant miss is empty, including owner mismatch', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-miss-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'Insert undo is restored.',
      source: 'job',
      jobId: 'job_1',
    })
    expect(store.recall('what did Research find')).toEqual([])
    expect(store.recall('what did Kernel find about parser')).toEqual([])
    expect(store.recall('')).toEqual([])
  })

  test('duplicate remember is one row', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-dupe-${Date.now()}.sqlite`))
    const input = {
      ownerAgentId: 'kernel' as const,
      text: 'Insert undo is restored.',
      source: 'job' as const,
      jobId: 'job_1',
    }
    store.remember(input)
    store.remember(input)
    expect(store.listClaims()).toHaveLength(1)
  })

  test('legacy turn receipts migrate inferenceAttempted as false', () => {
    const path = join(tmpdir(), `automaton-store-receipt-migrate-${Date.now()}.sqlite`)
    const db = new Database(path)
    db.exec(`
      CREATE TABLE turn_receipts (
        user_item_id TEXT PRIMARY KEY,
        outcome TEXT NOT NULL,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_usd REAL,
        inference_avoided INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    db.run(
      `INSERT INTO turn_receipts (
        user_item_id, outcome, model, prompt_tokens, completion_tokens, cost_usd,
        inference_avoided, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['item_legacy', 'hit', null, 0, 0, 0, 1, 'complete', '2026-01-01T00:00:00.000Z'],
    )
    db.close()

    const store = openStaffStore(path)
    const receipt = store.receipt('item_legacy')
    expect(receipt?.inferenceAvoided).toBe(true)
    expect(receipt?.inferenceAttempted).toBe(false)
    const ledger = store.metrics()
    expect(ledger.turns).toBe(1)
    expect(ledger.hits).toBe(1)
    expect(ledger.inferenceAvoided).toBe(1)
    expect(ledger.inferenceCalls).toBe(0)
    expect(ledger.promptTokens).toBe(0)
    expect(ledger.costUsd).toBe(0)
  })

  test('metrics sum known usage and stay null when any attempted call is unknown', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-ledger-${Date.now()}.sqlite`))
    const hit: TurnReceipt = {
      userItemId: 'item_hit',
      outcome: 'hit',
      model: null,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      inferenceAvoided: true,
      inferenceAttempted: false,
      status: 'complete',
    }
    const knownMiss: TurnReceipt = {
      userItemId: 'item_known',
      outcome: 'miss',
      model: 'openai/gpt-4o-mini',
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.001,
      inferenceAvoided: false,
      inferenceAttempted: true,
      status: 'complete',
    }
    const keyMiss: TurnReceipt = {
      userItemId: 'item_nokey',
      outcome: 'miss',
      model: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      inferenceAvoided: false,
      inferenceAttempted: false,
      status: 'failed',
    }
    store.recordReceipt(hit)
    store.recordReceipt(knownMiss)
    store.recordReceipt(keyMiss)
    const known = store.metrics()
    expect(known.turns).toBe(3)
    expect(known.hits).toBe(1)
    expect(known.misses).toBe(2)
    expect(known.inferenceAvoided).toBe(1)
    expect(known.inferenceCalls).toBe(1)
    expect(known.promptTokens).toBe(10)
    expect(known.completionTokens).toBe(5)
    expect(known.costUsd).toBe(0.001)
    expect(known.promptTokensKnown).toBe(1)
    expect(known.promptTokensUnknown).toBe(0)
    expect(known.costKnown).toBe(1)
    expect(known.costUnknown).toBe(0)

    store.recordReceipt({
      userItemId: 'item_unknown',
      outcome: 'miss',
      model: 'openai/gpt-4o-mini',
      promptTokens: null,
      completionTokens: 2,
      costUsd: null,
      inferenceAvoided: false,
      inferenceAttempted: true,
      status: 'complete',
    })
    const mixed = store.metrics()
    expect(mixed.inferenceCalls).toBe(2)
    expect(mixed.promptTokens).toBeNull()
    expect(mixed.completionTokens).toBe(7)
    expect(mixed.costUsd).toBeNull()
    expect(mixed.promptTokensKnown).toBe(1)
    expect(mixed.promptTokensUnknown).toBe(1)
    expect(mixed.completionTokensKnown).toBe(2)
    expect(mixed.completionTokensUnknown).toBe(0)
    expect(mixed.costKnown).toBe(1)
    expect(mixed.costUnknown).toBe(1)
  })
})
