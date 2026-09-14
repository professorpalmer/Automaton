import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyThreads,
  resetIdsForTests,
  sisterHopRefusal,
  staffWithSisters,
  type Agent,
} from '../src/domain'
import {
  findInFlightMouthStreamArcs,
  scrubIncompleteToolPairs,
  type ProviderSeedMessage,
} from '../src/runtime/history-sanitize'
import {
  effectiveMayAddressIds,
  mayAddress,
  normalizeMayAddressIds,
} from '../src/runtime/hop-grants'
import { parseProfile } from '../src/runtime/profile'
import {
  appendMouthStream,
  failMouth,
  offerSisterHop,
  send,
  sendToAgent,
  stopRun,
  takePendingLedger,
  terminalizeInFlightMouthStreams,
  type Session,
} from '../src/session'
import { buildWorkingSet as buildWs } from '../src/runtime/working-set'

const root = join(import.meta.dir, '..')

function fresh(): Session {
  resetIdsForTests()
  const agents = staffWithSisters()
  return {
    agents,
    activeAgentId: 'staff',
    threads: emptyThreads(agents),
    jobs: [],
    pendingFanout: null,
  }
}

function withMouth(session: Session, agentId: string, mouth: 'answer' | 'idle' | 'working'): Session {
  const row = session.threads[agentId]
  if (!row) return session
  return { ...session, threads: { ...session.threads, [agentId]: { ...row, mouth } } }
}

describe('wave 7 p1a history hygiene', () => {
  test('findInFlightMouthStreamArcs sees decide/act without done/refuse', () => {
    let session = fresh()
    session = appendMouthStream(session, 'kernel', {
      phase: 'decide',
      tool: 'box_shell',
      intent: 'shell',
      detail: '/tmp',
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'act',
      tool: 'box_shell',
      intent: 'shell',
      detail: '/tmp',
    })
    const arcs = findInFlightMouthStreamArcs(session.threads.kernel!.items)
    expect(arcs).toEqual([{ tool: 'box_shell', intent: 'shell', detail: '/tmp', bytes: undefined }])
  })

  test('stopRun mid-act terminalizes refuse and keeps feed rows; next send works', () => {
    let session = { ...fresh(), activeAgentId: 'kernel' as const }
    session = send(session, 'run a shell')
    session = withMouth(session, 'kernel', 'answer')
    session = appendMouthStream(session, 'kernel', {
      phase: 'decide',
      tool: 'box_shell',
      intent: 'shell',
    })
    session = appendMouthStream(session, 'kernel', {
      phase: 'act',
      tool: 'box_shell',
      intent: 'shell',
    })
    const before = session.threads.kernel!.items.length
    session = stopRun(session, 'kernel')
    const items = session.threads.kernel!.items
    expect(items.length).toBeGreaterThan(before)
    expect(items.filter((row) => row.kind === 'mouth-stream').length).toBe(3)
    const lastStream = [...items].reverse().find((row) => row.kind === 'mouth-stream')
    expect(lastStream).toMatchObject({
      kind: 'mouth-stream',
      phase: 'refuse',
      tool: 'box_shell',
      intent: 'shell',
      detail: 'Stopped.',
    })
    expect(findInFlightMouthStreamArcs(items)).toEqual([])
    expect(session.threads.kernel!.mouth).toBe('idle')

    // Next chat must succeed (working set builds; send parks answer).
    session = send(session, 'hello again')
    expect(session.threads.kernel!.mouth === 'answer' || session.threads.kernel!.mouth === 'ack').toBe(true)
    const user = [...session.threads.kernel!.items]
      .reverse()
      .find((row) => row.kind === 'msg' && row.from === 'user' && row.text === 'hello again')
    expect(user).toBeTruthy()
    const ws = buildWs({
      agent: session.agents.find((a) => a.id === 'kernel')!,
      thread: session.threads.kernel!,
      claims: [],
      query: 'hello again',
    })
    expect(ws.some((turn) => turn.role === 'user')).toBe(true)
  })

  test('failMouth terminalizes in-flight arcs without deleting prior stream rows', () => {
    let session = withMouth(fresh(), 'staff', 'answer')
    session = appendMouthStream(session, 'staff', { phase: 'decide', tool: 'host_shell', intent: 'shell' })
    session = appendMouthStream(session, 'staff', { phase: 'act', tool: 'host_shell', intent: 'shell' })
    const priorIds = session.threads.staff!.items
      .filter((row) => row.kind === 'mouth-stream')
      .map((row) => row.id)
    session = failMouth(session, 'staff', "Couldn't reach OpenRouter.")
    const streams = session.threads.staff!.items.filter((row) => row.kind === 'mouth-stream')
    expect(streams.map((row) => row.id).slice(0, 2)).toEqual(priorIds)
    expect(streams.at(-1)).toMatchObject({ phase: 'refuse', tool: 'host_shell' })
  })

  test('scrubIncompleteToolPairs drops dangling calls; does not invent results', () => {
    const history: ProviderSeedMessage[] = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1' }, { id: 'call_2' }],
      },
      { role: 'tool', toolCallId: 'call_1', content: 'ok' },
      // call_2 never answered — interrupt poison
      { role: 'user', content: 'retry' },
    ]
    const scrubbed = scrubIncompleteToolPairs(history)
    const assistant = scrubbed.find((row) => row.role === 'assistant' && row.toolCalls)
    expect(assistant?.toolCalls).toEqual([{ id: 'call_1' }])
    expect(scrubbed.some((row) => row.toolCallId === 'call_2')).toBe(false)
    expect(scrubbed.some((row) => row.toolCallId === 'call_1')).toBe(true)
    // No fake tool result invented for call_2
    expect(scrubbed.filter((row) => row.role === 'tool')).toHaveLength(1)
  })

  test('scrub leaves healthy history as same object refs', () => {
    const history: ProviderSeedMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hey' },
    ]
    const scrubbed = scrubIncompleteToolPairs(history)
    expect(scrubbed).toHaveLength(3)
    expect(scrubbed[0]).toBe(history[0])
    expect(scrubbed[1]).toBe(history[1])
    expect(scrubbed[2]).toBe(history[2])
  })

  test('terminalize is a no-op when arcs already terminal', () => {
    let session = fresh()
    session = appendMouthStream(session, 'kernel', { phase: 'decide', tool: 'box_shell', intent: 'shell' })
    session = appendMouthStream(session, 'kernel', { phase: 'done', tool: 'box_shell', intent: 'shell' })
    const before = session.threads.kernel!.items.length
    session = terminalizeInFlightMouthStreams(session, 'kernel')
    expect(session.threads.kernel!.items.length).toBe(before)
  })
})

describe('wave 7 p1b hop mayAddress grants', () => {
  test('default missing grants preserve open UX', () => {
    expect(mayAddress('staff', 'kernel')).toBe(true)
    expect(mayAddress('staff', 'kernel', undefined)).toBe(true)
    expect(mayAddress('staff', 'kernel', null)).toBe(true)
    expect(sisterHopRefusal(
      { from: 'staff', to: 'kernel', task: 'Check.', depth: 0 },
      staffWithSisters(),
      0,
    )).toBeNull()
    expect(sisterHopRefusal(
      { from: 'staff', to: 'kernel', task: 'Check.', depth: 0 },
      staffWithSisters(),
      0,
      undefined,
    )).toBeNull()
  })

  test('explicit allowlist refuses unspoken targets with spoken line + ledger', () => {
    let session = fresh()
    session = {
      ...session,
      agents: session.agents.map((agent) =>
        agent.id === 'staff' ? { ...agent, mayAddressIds: ['research'] } : agent,
      ),
    }
    session = withMouth(session, 'staff', 'answer')
    session = offerSisterHop(session, {
      from: 'staff',
      to: 'kernel',
      task: 'Check the pin.',
      depth: 0,
    })
    expect(session.threads.staff!.items.at(-1)).toMatchObject({
      text: 'Not allowed to hand that to Kernel.',
    })
    expect(session.threads.kernel!.mouth).toBe('idle')
    const { session: drained, events } = takePendingLedger(session)
    expect(drained.pendingLedger).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      tool: 'hop',
      intent: 'hand_off',
      decision: 'refuse',
      reason: 'not_granted',
      path: 'kernel',
      ownerAgentId: 'staff',
    })
  })

  test('grant allowlist still permits listed sisters', () => {
    let session = fresh()
    session = {
      ...session,
      agents: session.agents.map((agent) =>
        agent.id === 'staff' ? { ...agent, mayAddressIds: ['kernel'] } : agent,
      ),
    }
    session = offerSisterHop(session, {
      from: 'staff',
      to: 'kernel',
      task: 'Check the pin.',
      depth: 0,
    })
    expect(session.threads.staff!.items.some((row) => row.kind === 'msg' && row.text === 'Handed to Kernel.')).toBe(
      true,
    )
    expect(takePendingLedger(session).events).toEqual([])
  })

  test('sendToAgent enforces grants with spoken refuse', () => {
    let session = fresh()
    session = {
      ...session,
      agents: session.agents.map((agent): Agent =>
        agent.id === 'staff' ? { ...agent, mayAddressIds: [] } : agent,
      ),
    }
    session = sendToAgent(session, 'staff', 'kernel', 'Please look')
    expect(session.threads.staff!.items.at(-1)).toMatchObject({
      text: 'Not allowed to hand that to Kernel.',
    })
    expect(session.threads.kernel!.items.some((row) => row.kind === 'agent_note')).toBe(false)
    expect(takePendingLedger(session).events[0]?.reason).toBe('not_granted')
  })

  test('profile parse hydrates mayAddressIds; normalize trims', () => {
    const parsed = parseProfile({ name: 'Scout', mayAddressIds: [' kernel ', 'kernel', ''] }, 'agent_9')
    expect(parsed.mayAddressIds).toEqual(['kernel'])
    expect(normalizeMayAddressIds(['a', ' a ', 'b'])).toEqual(['a', 'b'])
    expect(effectiveMayAddressIds(['kernel', 'research'], ['kernel'])).toEqual(['kernel'])
    expect(effectiveMayAddressIds(undefined, ['kernel'])).toEqual(['kernel'])
  })

  test('docs note exists and policy forbids CopilotKit', () => {
    const doc = readFileSync(join(root, 'docs/wave7-p1-history-hop-grants.md'), 'utf8')
    expect(doc).toContain('mayAddress')
    expect(doc).toContain('history-sanitize')
    expect(doc.toLowerCase()).toContain('no `@ag-ui')
  })
})
