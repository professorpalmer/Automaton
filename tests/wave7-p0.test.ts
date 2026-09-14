import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  askPersonWidget,
  emptyThreads,
  parseMouthEmit,
  resetIdsForTests,
  staffWithSisters,
} from '../src/domain'
import {
  createMouthStallWatch,
  isMouthStallError,
  mouthStallMs,
  MOUTH_STALL_SPEAK,
  MouthStallError,
  raceAgainstStall,
  readResponseTextWithStall,
} from '../src/runtime/mouth-stall'
import {
  hopRelayLabel,
  mouthStreamSuperseded,
  mouthStreamTone,
  mouthStreamToolLabel,
  shouldPaintHopRelay,
} from '../src/runtime/mouth-tool-line'
import { mouthFailSpeak } from '../src/runtime/mouth'
import { WIDGET_CUE } from '../src/runtime/working-set'
import {
  answerWidget,
  appendMouthStream,
  clearStoppedReason,
  completeMouth,
  emitAskPerson,
  failMouth,
  offerSisterHop,
  send,
  setStoppedReason,
  type Session,
} from '../src/session'

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

function withMouth(session: Session, agentId: string, mouth: 'answer' | 'idle'): Session {
  const row = session.threads[agentId]
  if (!row) return session
  return { ...session, threads: { ...session.threads, [agentId]: { ...row, mouth } } }
}

describe('wave 7 p0 ToolLine fold + hop cards', () => {
  test('mouthStreamSuperseded collapses decide→act→done to latest phase', () => {
    let session = fresh()
    session = appendMouthStream(session, 'kernel', { phase: 'decide', tool: 'box_shell', intent: 'shell' })
    session = appendMouthStream(session, 'kernel', { phase: 'act', tool: 'box_shell', intent: 'shell' })
    session = appendMouthStream(session, 'kernel', { phase: 'done', tool: 'box_shell', intent: 'shell' })
    const items = session.threads.kernel!.items
    expect(mouthStreamSuperseded(items, 0)).toBe(true)
    expect(mouthStreamSuperseded(items, 1)).toBe(true)
    expect(mouthStreamSuperseded(items, 2)).toBe(false)
    expect(mouthStreamTone('act').running).toBe(true)
    expect(mouthStreamTone('refuse').refused).toBe(true)
    expect(mouthStreamToolLabel('ask_person', 'ask')).toBe('Asked you')
    expect(mouthStreamToolLabel('box_shell', 'shell')).toBe('shell')
  })

  test('offerSisterHop stamps sent relay envelope for ToolLine disclosure', () => {
    let session = fresh()
    session = offerSisterHop(session, {
      from: 'staff',
      to: 'kernel',
      task: 'Check the pin.',
      constraints: 'No merge.',
      expecting: 'A one-line status.',
      depth: 0,
    })
    const relays = (session.threads.staff?.items ?? []).filter((row) => row.kind === 'relay')
    expect(relays.length).toBeGreaterThanOrEqual(1)
    const sent = relays.find((row) => row.kind === 'relay' && row.lane === 'sent')
    expect(sent?.kind).toBe('relay')
    if (sent?.kind !== 'relay') throw new Error('expected sent relay')
    expect(sent.task).toBe('Check the pin.')
    expect(sent.constraints).toBe('No merge.')
    expect(sent.expecting).toBe('A one-line status.')
    expect(shouldPaintHopRelay(sent)).toBe(true)
    expect(hopRelayLabel('sent', 'Kernel')).toBe('Sent to Kernel')
  })

  test('tool-line chrome is native (no CopilotKit)', () => {
    const toolLine = readFileSync(join(root, 'src/chrome/tool-line.tsx'), 'utf8')
    expect(toolLine).toContain('ToolLine')
    expect(toolLine).not.toContain('@copilotkit')
    expect(toolLine).not.toContain('@ag-ui')
    const pkg = readFileSync(join(root, 'package.json'), 'utf8')
    expect(pkg).not.toContain('@ag-ui')
    expect(pkg).not.toContain('copilotkit')
  })
})

describe('wave 7 p0 ask_person', () => {
  test('parseMouthEmit reads ask_person and refuses blank question', () => {
    expect(parseMouthEmit('{"type":"ask_person","question":"   "}')).toBeNull()
    expect(parseMouthEmit('{"type":"ask_person","question":"Ship tonight?","why":"Only you can decide."}')).toEqual({
      kind: 'ask_person',
      question: 'Ship tonight?',
      why: 'Only you can decide.',
    })
    const widget = askPersonWidget('Ship tonight?', 'Only you can decide.')
    expect(widget.allowCustom).toBe(true)
    expect(widget.helpText).toBe('Only you can decide.')
  })

  test('completeMouth ask_person parks widget + mouth-stream and resumes on answer', () => {
    let session = fresh()
    session = withMouth(session, 'staff', 'answer')
    session = completeMouth(
      session,
      'staff',
      JSON.stringify({ type: 'ask_person', question: 'Merge dest?', why: 'Policy call.' }),
    )
    const items = session.threads.staff!.items
    const streams = items.filter((row) => row.kind === 'mouth-stream')
    expect(streams.map((row) => (row.kind === 'mouth-stream' ? row.phase : null))).toEqual([
      'decide',
      'act',
      'done',
    ])
    expect(streams.every((row) => row.kind === 'mouth-stream' && row.tool === 'ask_person')).toBe(true)
    const widget = items.find((row) => row.kind === 'widget' && row.status === 'open')
    expect(widget?.kind).toBe('widget')
    if (widget?.kind !== 'widget') throw new Error('expected widget')
    expect(widget.purpose).toBe('ask')
    expect(widget.widget.prompt).toBe('Merge dest?')
    expect(widget.widget.helpText).toBe('Policy call.')
    expect(session.threads.staff?.mouth).toBe('idle')
    expect(WIDGET_CUE).toContain('ask_person')

    session = answerWidget(session, widget.id, { values: [], custom: 'Hold the merge.' })
    const lastUser = [...(session.threads.staff?.items ?? [])]
      .reverse()
      .find((row) => row.kind === 'msg' && row.from === 'user')
    expect(lastUser?.kind === 'msg' && lastUser.text).toBe('Hold the merge.')
  })

  test('emitAskPerson refuses empty question', () => {
    let session = fresh()
    session = emitAskPerson(session, 'staff', '  ')
    const spoken = session.threads.staff?.items.find((row) => row.kind === 'msg' && row.from === 'agent')
    expect(spoken?.kind === 'msg' && spoken.text).toContain('Need a question')
  })
})

describe('wave 7 p0 mouth silence watchdog', () => {
  test('injectable clock stalls after silence; 0 disables', () => {
    expect(mouthStallMs({ AUTOMATON_MOUTH_STALL_MS: '0' })).toBe(0)
    expect(createMouthStallWatch({ stallMs: 0 })).toBeNull()
    let now = 1_000
    const watch = createMouthStallWatch({ stallMs: 100, now: () => now })
    expect(watch).not.toBeNull()
    expect(watch!.isStalled()).toBe(false)
    now = 1_099
    expect(watch!.isStalled()).toBe(false)
    now = 1_100
    expect(watch!.isStalled()).toBe(true)
    watch!.noteChunk()
    now = 1_150
    expect(watch!.isStalled()).toBe(false)
    now = 1_250
    expect(watch!.stalled()?.chunks).toBe(1)
  })

  test('raceAgainstStall rejects when clock advances past stallMs', async () => {
    let now = 0
    const watch = createMouthStallWatch({ stallMs: 50, now: () => now })!
    const hung = new Promise<string>(() => {})
    const ticks: Array<() => void> = []
    const tick = () =>
      new Promise<void>((resolve) => {
        ticks.push(() => {
          now += 25
          resolve()
        })
      })
    const raced = raceAgainstStall(hung, watch, { tick })
    // Drive a few ticks past stall
    for (let i = 0; i < 4; i++) {
      await Promise.resolve()
      const next = ticks.shift()
      next?.()
    }
    await expect(raced).rejects.toBeInstanceOf(MouthStallError)
  })

  test('readResponseTextWithStall fails on silent body; mouthFailSpeak is distinct', async () => {
    let now = 0
    const body = new ReadableStream<Uint8Array>({
      start() {
        /* never enqueue — silence */
      },
    })
    const response = new Response(body, { status: 200 })
    const ticks: Array<() => void> = []
    const tick = () =>
      new Promise<void>((resolve) => {
        ticks.push(() => {
          now += 30
          resolve()
        })
      })
    const pending = readResponseTextWithStall(response, {
      stallMs: 50,
      now: () => now,
      tick,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    )
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
      await Promise.resolve()
      ticks.shift()?.()
      const state = await Promise.race([pending, Promise.resolve(null)])
      if (state) {
        expect(state.ok).toBe(false)
        if (!state.ok) expect(isMouthStallError(state.error)).toBe(true)
        expect(mouthFailSpeak(new MouthStallError({ silentForMs: 50, chunks: 0 }))).toBe(MOUTH_STALL_SPEAK)
        expect(mouthFailSpeak(new Error('empty mouth'))).not.toBe(MOUTH_STALL_SPEAK)
        return
      }
    }
    throw new Error('expected stall rejection')
  })

  test('failMouth parks sticky stoppedReason; send clears it', () => {
    let session = fresh()
    session = withMouth(session, 'staff', 'answer')
    session = failMouth(session, 'staff', MOUTH_STALL_SPEAK)
    expect(session.threads.staff?.stoppedReason).toBe(MOUTH_STALL_SPEAK)
    session = clearStoppedReason(session, 'staff')
    expect(session.threads.staff?.stoppedReason).toBeUndefined()
    session = setStoppedReason(session, 'staff', MOUTH_STALL_SPEAK)
    session = send(session, 'try again')
    expect(session.threads.staff?.stoppedReason).toBeUndefined()
  })
})
