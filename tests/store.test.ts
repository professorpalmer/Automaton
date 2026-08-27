import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_AGENTS, emptyThreads, peekIdSeq, resetIdsForTests, type GoalReceipt } from '../src/domain'
import { goalEventsFromSessions, openStaffStore, type TurnReceipt } from '../src/runtime/store.ts'
import { cancelGoal, retryGoal, send, waitJobExternal, waitJobUser } from '../src/session'

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
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_roundtrip',
    })
    resetIdsForTests()
    const loaded = openStaffStore(path)
    expect(loaded.load()?.threads.staff.items).toHaveLength(1)
    expect(peekIdSeq()).toBeGreaterThan(0)
    const claimed = loaded.recall('Ledger replay')
    expect(claimed[0]?.text).toBe('The ledger replay is deterministic.')
    expect(claimed[0]?.id).toBeTruthy()
    expect(claimed[0]?.source).toBe('job')
    expect(claimed[0]?.jobId).toBe('job_roundtrip')
  })

  test('GoalRun and job associations survive reload; old snapshots hydrate empty goals', () => {
    resetIdsForTests()
    const path = join(tmpdir(), `automaton-store-goals-${Date.now()}.sqlite`)
    const store = openStaffStore(path)
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'install curl on the computer then check if python is on PATH')
    expect(session.goals).toHaveLength(1)
    expect(session.jobs[0]?.goalId).toBe(session.goals?.[0]?.id)
    store.save(session)
    const loaded = openStaffStore(path).load()
    expect(loaded?.goals).toHaveLength(1)
    expect(loaded?.goals?.[0]?.criteria.map((row) => row.kind)).toEqual(['box-shell', 'box-shell'])
    expect(loaded?.jobs[0]?.goalId).toBe(loaded?.goals?.[0]?.id)
    expect(loaded?.jobs[0]?.criterionId).toBe(loaded?.goals?.[0]?.criteria[0]?.id)
    expect(loaded?.threads.staff).not.toHaveProperty('mandate')

    const legacy = join(tmpdir(), `automaton-store-legacy-goals-${Date.now()}.sqlite`)
    const db = new Database(legacy)
    db.exec(
      `CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), session_json TEXT NOT NULL, id_seq INTEGER NOT NULL)`,
    )
    db.run('INSERT INTO snapshot (id, session_json, id_seq) VALUES (1, ?, 3)', [
      JSON.stringify({
        agents: DEFAULT_AGENTS,
        activeAgentId: 'staff',
        threads: {
          staff: {
            agentId: 'staff',
            items: [],
            draft: '',
            pendingPaths: [],
            mouth: 'idle',
            unread: 0,
            mandate: { text: 'stale leftover', steps: 2 },
          },
        },
        jobs: [],
        pendingFanout: null,
      }),
    ])
    db.close()
    const old = openStaffStore(legacy).load()
    expect(old?.goals).toEqual([])
    expect(old?.threads.staff).not.toHaveProperty('mandate')
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
      'The ledger replay is deterministic.',
      '2026-01-01T00:00:00.000Z',
    ])
    db.close()

    const store = openStaffStore(path)
    const rows = store.listClaims()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBeTruthy()
    expect(rows[0]?.ownerAgentId).toBe('kernel')
    expect(rows[0]?.text).toBe('The ledger replay is deterministic.')
    expect(rows[0]?.source).toBe('mouth')
    expect(rows[0]?.jobId).toBeUndefined()
    expect(rows[0]?.taskKey).toBeUndefined()
    expect(rows[0]?.repo).toBeUndefined()
    expect(rows[0]?.revision).toBeUndefined()
    expect(rows[0]?.artifactKind).toBeUndefined()
    expect(rows[0]?.freshness).toBe('unknown')

    store.remember({
      ownerAgentId: 'research',
      text: 'Looked up the pin.',
      source: 'job',
      jobId: 'job_abc',
    })
    const again = openStaffStore(path).listClaims()
    expect(again).toHaveLength(2)
    expect(again.find((row) => row.jobId === 'job_abc')?.source).toBe('job')
    expect(again.find((row) => row.text === 'The ledger replay is deterministic.')?.id).toBe(rows[0]?.id)
  })

  test('relevant miss is empty, including owner mismatch', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-miss-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_1',
    })
    expect(store.recall('what did Research find')).toEqual([])
    expect(store.recall('what did Kernel find about parser')).toEqual([])
    expect(store.recall('')).toEqual([])
  })

  test('token LIKE recall still feeds stale claims as context', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-stale-like-${Date.now()}.sqlite`))
    store.remember({
      ownerAgentId: 'kernel',
      text: 'The ledger replay is deterministic.',
      source: 'job',
      jobId: 'job_stale',
      taskKey: 'kernel:analyze:ledger replay',
      artifactKind: 'analyze',
      freshness: 'stale',
    })
    const recalled = store.recall('ledger replay')
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.text).toBe('The ledger replay is deterministic.')
    expect(recalled[0]?.freshness).toBe('stale')
    expect(recalled[0]?.taskKey).toBe('kernel:analyze:ledger replay')
  })

  test('duplicate remember is one row', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-dupe-${Date.now()}.sqlite`))
    const input = {
      ownerAgentId: 'kernel' as const,
      text: 'The ledger replay is deterministic.',
      source: 'job' as const,
      jobId: 'job_1',
    }
    store.remember(input)
    store.remember(input)
    expect(store.listClaims()).toHaveLength(1)
  })

  test('remember idempotency includes provenance', () => {
    const store = openStaffStore(join(tmpdir(), `automaton-store-provenance-${Date.now()}.sqlite`))
    const analyze = {
      ownerAgentId: 'kernel' as const,
      text: 'The ledger replay is deterministic.',
      source: 'job' as const,
      jobId: 'job_analyze',
      taskKey: 'kernel:analyze:ledger replay',
      repo: 'automaton',
      revision: 'abc123',
      artifactKind: 'analyze' as const,
      freshness: 'fresh' as const,
    }
    store.remember(analyze)
    store.remember(analyze)
    expect(store.listClaims()).toHaveLength(1)
    store.remember({
      ...analyze,
      jobId: 'job_implement',
      taskKey: 'kernel:implement:ledger replay',
      artifactKind: 'implement',
    })
    const rows = store.listClaims()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.taskKey).sort()).toEqual([
      'kernel:analyze:ledger replay',
      'kernel:implement:ledger replay',
    ])
    expect(rows.find((row) => row.taskKey === analyze.taskKey)?.freshness).toBe('fresh')
    expect(rows.find((row) => row.taskKey === analyze.taskKey)?.repo).toBe('automaton')
    expect(rows.find((row) => row.taskKey === analyze.taskKey)?.revision).toBe('abc123')
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

  test('legacy wave-10 db gains an attachments table without altering claims', () => {
    const path = join(tmpdir(), `automaton-store-attach-${Date.now()}.sqlite`)
    const db = new Database(path)
    db.exec(`
      CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), session_json TEXT NOT NULL, id_seq INTEGER NOT NULL);
      CREATE TABLE claims (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_agent_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE turn_receipts (
        user_item_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, model TEXT,
        prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL,
        inference_avoided INTEGER NOT NULL, inference_attempted INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
    db.close()
    const store = openStaffStore(path)
    store.recordAttachment({
      id: 'att_1',
      ownerAgentId: 'staff',
      path: '/tmp/shot.png',
      hash: 'abc',
      mime: 'image/png',
      kind: 'image',
    })
    store.bindAttachments(['att_1'], 'item_9')
    expect(store.attachmentsForItem('item_9')).toHaveLength(1)
    expect(store.listAttachments('staff')[0]?.path).toBe('/tmp/shot.png')
    const cols = new Database(path)
      .query('PRAGMA table_info(claims)')
      .all() as { name: string }[]
    expect(cols.some((col) => col.name === 'path')).toBe(false)
  })

  test('goal events append once per fact and survive reopen without duplicates', () => {
    resetIdsForTests()
    const path = join(tmpdir(), `automaton-store-goal-events-${Date.now()}.sqlite`)
    const store = openStaffStore(path)
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'install curl on the computer then check if python is on PATH')
    store.save(session)
    store.save(session)
    const opened = store.listGoalEvents(session.goals?.[0]?.id)
    expect(opened.map((row) => row.kind)).toEqual(['opened', 'booked'])
    expect(opened.map((row) => row.authority)).toEqual(['user_request', 'goal_policy'])
    expect(opened[0]?.goalId).toBe(session.goals?.[0]?.id)
    expect(opened[1]?.jobId).toBe(session.jobs[0]?.id)
    expect(opened.every((row) => !/OPENROUTER|sk-|AUTOMATON_HOME/.test(row.reason))).toBe(true)

    session = waitJobUser(session, session.jobs[0]!.id, 'Need a product checkout to land dest.', 'staff')
    store.save(session)
    store.save(session)
    const waiting = store.listGoalEvents(session.goals?.[0]?.id)
    expect(waiting.map((row) => row.kind)).toEqual(['opened', 'booked', 'waiting_user'])
    expect(waiting[2]?.reason).toContain('Need a product checkout')
    expect(waiting[2]?.source).toBe('staff')
    expect(waiting[2]?.authority).toBe('goal_policy')
    expect(waiting[2]?.jobId).toBe(session.jobs[0]?.id)

    const blockedCriterionId = session.goals![0]!.blocker!.criterionId
    const parkedJobId = session.jobs[0]!.id
    const retried = retryGoal(session, session.goals![0]!.id)
    const freshJob = retried.jobs[retried.jobs.length - 1]
    expect(freshJob?.id).not.toBe(parkedJobId)
    store.save(retried)
    store.save(retried)
    const afterRetry = store.listGoalEvents(retried.goals?.[0]?.id)
    expect(afterRetry.map((row) => row.kind)).toEqual(['opened', 'booked', 'waiting_user', 'retry', 'booked'])
    expect(afterRetry.filter((row) => row.kind === 'booked')).toHaveLength(2)
    expect(afterRetry[3]?.kind).toBe('retry')
    expect(afterRetry[3]?.source).toBe('user')
    expect(afterRetry[3]?.authority).toBe('operator_action')
    expect(afterRetry[3]?.jobId).toBe(freshJob?.id)
    expect(afterRetry[4]?.kind).toBe('booked')
    expect(afterRetry[4]?.source).toBe('staff')
    expect(afterRetry[4]?.authority).toBe('goal_policy')
    expect(afterRetry[4]?.jobId).toBe(freshJob?.id)

    const external = waitJobExternal(retried, freshJob!.id)
    store.save(external)
    store.save(external)
    const afterExternal = store.listGoalEvents(external.goals?.[0]?.id)
    expect(afterExternal.map((row) => row.kind)).toEqual([
      'opened',
      'booked',
      'waiting_user',
      'retry',
      'booked',
      'waiting_external',
    ])
    expect(afterExternal[5]?.jobId).toBe(freshJob?.id)
    expect(afterExternal[5]?.jobId).not.toBe(parkedJobId)
    expect(afterExternal[5]?.source).toBe('host')
    expect(afterExternal[5]?.authority).toBe('external_state')

    const cancelled = cancelGoal(session, session.goals![0]!.id)
    const cancelStore = openStaffStore(join(tmpdir(), `automaton-store-goal-cancel-${Date.now()}.sqlite`))
    cancelStore.save(session)
    cancelStore.save(cancelled)
    cancelStore.save(cancelled)
    const cancelEvents = cancelStore.listGoalEvents(cancelled.goals?.[0]?.id)
    expect(cancelEvents.map((row) => row.kind)).toEqual([
      'opened',
      'booked',
      'waiting_user',
      'cancelled',
    ])
    expect(cancelEvents[3]?.criterionId).toBe(blockedCriterionId)
    expect(cancelEvents[3]?.source).toBe('user')
    expect(cancelEvents[3]?.authority).toBe('operator_action')

    const reopened = openStaffStore(path)
    expect(reopened.listGoalEvents(external.goals?.[0]?.id).map((row) => row.kind)).toEqual(
      afterExternal.map((row) => row.kind),
    )
    reopened.save(external)
    expect(reopened.listGoalEvents(external.goals?.[0]?.id)).toHaveLength(afterExternal.length)
    expect(reopened.listGoalEvents('goal_missing')).toEqual([])
  })

  test('waiting_user ledger source follows blocker provenance', () => {
    resetIdsForTests()
    const path = join(tmpdir(), `automaton-store-blocker-source-${Date.now()}.sqlite`)
    const store = openStaffStore(path)
    let session = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
    }
    session = send(session, 'install curl on the computer')
    const jobId = session.jobs[0]!.id
    const hostWait = waitJobUser(session, jobId, 'HTTP 401 Unauthorized', 'host')
    store.save(hostWait)
    expect(store.listGoalEvents(hostWait.goals?.[0]?.id).at(-1)).toMatchObject({
      kind: 'waiting_user',
      source: 'host',
      authority: 'external_state',
      jobId,
    })

    const jobPath = join(tmpdir(), `automaton-store-blocker-job-${Date.now()}.sqlite`)
    const jobStore = openStaffStore(jobPath)
    const jobWait = waitJobUser(session, jobId, 'HTTP 401 Unauthorized', 'job')
    jobStore.save(jobWait)
    expect(jobStore.listGoalEvents(jobWait.goals?.[0]?.id).at(-1)).toMatchObject({
      kind: 'waiting_user',
      source: 'job',
      authority: 'external_state',
      jobId,
    })
  })

  test('legacy goal_events migrate authority without dropping rows', () => {
    const path = join(tmpdir(), `automaton-store-goal-authority-${Date.now()}.sqlite`)
    const db = new Database(path)
    db.exec(`
      CREATE TABLE goal_events (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        criterion_id TEXT,
        job_id TEXT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `)
    db.run(
      `INSERT INTO goal_events (id, goal_id, criterion_id, job_id, kind, source, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['opened:goal_legacy', 'goal_legacy', null, null, 'opened', 'staff', 'install curl', 1],
    )
    db.close()

    const store = openStaffStore(path)
    const events = store.listGoalEvents('goal_legacy')
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('opened')
    expect(events[0]?.source).toBe('staff')
    expect(events[0]?.authority).toBe('user_request')
    expect(events[0]?.reason).toBe('install curl')
    const cols = new Database(path)
      .query('PRAGMA table_info(goal_events)')
      .all() as { name: string }[]
    expect(cols.some((col) => col.name === 'authority')).toBe(true)

    const raw = new Database(path)
    raw.run(
      `INSERT INTO goal_events (id, goal_id, criterion_id, job_id, kind, source, authority, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['opened:goal_bad', 'goal_bad', null, null, 'opened', 'staff', 'not-real', 'look this up', 2],
    )
    raw.close()
    expect(store.listGoalEvents('goal_bad')[0]?.authority).toBe('user_request')
  })

  test('receipt and terminal events record worker_result or Staff policy', () => {
    const goal = {
      id: 'goal_1',
      text: 'install curl on the computer',
      coordinatorId: 'staff' as const,
      ownerAgentId: 'staff' as const,
      criteria: [
        { id: 'crit_1', label: 'shell', kind: 'box-shell' as const, work: 'install curl', status: 'running' as const },
      ],
      receipts: [] as GoalReceipt[],
      status: 'running' as const,
      activeCriterionId: 'crit_1',
    }
    const prior = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
      goals: [goal],
    }
    const okEvents = goalEventsFromSessions(prior, {
      ...prior,
      goals: [
        {
          ...goal,
          status: 'complete',
          receipts: [{ id: 'rec_ok', criterionId: 'crit_1', jobId: 'job_1', spoken: 'curl is on PATH.', ok: true, at: 1 }],
        },
      ],
    })
    expect(okEvents.find((row) => row.kind === 'receipt_ok')).toMatchObject({
      source: 'job',
      authority: 'worker_result',
    })
    expect(okEvents.find((row) => row.kind === 'complete')).toMatchObject({
      source: 'staff',
      authority: 'goal_policy',
    })

    const failEvents = goalEventsFromSessions(prior, {
      ...prior,
      goals: [
        {
          ...goal,
          status: 'failed',
          receipts: [{ id: 'rec_fail', criterionId: 'crit_1', jobId: 'job_1', spoken: 'apt failed.', ok: false, at: 2 }],
        },
      ],
    })
    expect(failEvents.find((row) => row.kind === 'receipt_fail')).toMatchObject({
      source: 'job',
      authority: 'worker_result',
    })
    expect(failEvents.find((row) => row.kind === 'failed')).toMatchObject({
      source: 'job',
      authority: 'worker_result',
    })
  })
})
