import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WIDGET_OPTION_CAP,
  clampWidgetOptions,
  emptyThreads,
  hostApprovalWidget,
  landWidgetForKind,
  normalizeWidget,
  parseMouthEmit,
  resetIdsForTests,
  staffWithSisters,
  widgetDismissOnMoveOn,
  widgetReplyText,
  type WidgetOption,
} from '../src/domain'
import { OPENROUTER_ID } from '../src/runtime/connectors'
import { writeProfile } from '../src/runtime/profile'
import {
  answerWidget,
  completeJob,
  completeMouth,
  emitSecretRequest,
  emitWidget,
  failJob,
  fulfillSecretRequest,
  send,
  type Session,
} from '../src/session'

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

function openWidget(session: Session, agentId = 'staff') {
  return session.threads[agentId]?.items.find((item) => item.kind === 'widget' && item.status === 'open')
}

function marionetteHome() {
  const home = join(tmpdir(), `automaton-w4-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  writeProfile(
    {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      rules: '',
      kit: 'code',
      avatarShape: 'blob',
      avatarColor: 'kernel',
      namedBy: 'user',
      skillIds: [],
      notifyOnUpdates: true,
      hiddenFromRail: false,
      createdAt: '2026-08-26T00:00:00.000Z',
      homeRepo: '',
      homePath: '',
    },
    home,
  )
  return home
}

const marionette = {
  id: 'agent_m',
  name: 'Marionette',
  title: '',
  description: '',
  color: '#777777',
  hidden: false,
}

describe('question widget', () => {
  test('option cap is 6', () => {
    const options: WidgetOption[] = Array.from({ length: 8 }, (_, i) => ({ label: `opt-${i + 1}` }))
    expect(clampWidgetOptions(options)).toHaveLength(WIDGET_OPTION_CAP)
    const widget = normalizeWidget({ prompt: 'Pick a lane', options })
    expect(widget?.options).toHaveLength(WIDGET_OPTION_CAP)
    expect(normalizeWidget({ prompt: 'Pick', options: [] })).toBeNull()
  })

  test('multiSelect return shape is values[]', () => {
    resetIdsForTests()
    let s = emitWidget(fresh(), 'staff', {
      prompt: 'Which trees?',
      options: [
        { label: 'Kernel', value: 'kernel' },
        { label: 'Research', value: 'research' },
        { label: 'Both', value: 'both' },
      ],
      multiSelect: true,
    })
    const widget = openWidget(s)
    expect(widget?.kind).toBe('widget')
    expect(widget?.widget.multiSelect).toBe(true)
    expect(s.threads.staff.mouth).toBe('idle')
    s = answerWidget(s, widget!.id, { values: ['kernel', 'research'] })
    const answered = s.threads.staff.items.find((item) => item.id === widget!.id)
    expect(answered?.kind === 'widget' && answered.answer).toEqual({ values: ['kernel', 'research'] })
    expect(widgetReplyText(widget!.widget, { values: ['kernel', 'research'] })).toBe('kernel, research')
    const reply = s.threads.staff.items.find((item) => item.kind === 'msg' && item.from === 'user')
    expect(reply?.kind === 'msg' && reply.text).toBe('kernel, research')
    expect(s.threads.staff.mouth).toBe('answer')
  })

  test('dismissOnMoveOn drops a low-stakes widget and stays off for merge/host/secret', () => {
    expect(widgetDismissOnMoveOn('ask', true)).toBe(true)
    expect(widgetDismissOnMoveOn('merge', true)).toBe(false)
    expect(widgetDismissOnMoveOn('host', true)).toBe(false)
    expect(widgetDismissOnMoveOn('ship', true)).toBe(false)
    let s = emitWidget(fresh(), 'staff', {
      prompt: 'Snack?',
      options: [{ label: 'Yes' }, { label: 'No' }],
      dismissOnMoveOn: true,
    })
    expect(openWidget(s)?.widget.dismissOnMoveOn).toBe(true)
    s = send(s, 'never mind, just say hello')
    const widget = s.threads.staff.items.find((item) => item.kind === 'widget')
    expect(widget?.kind === 'widget' && widget.status).toBe('dismissed')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.text.includes('hello'))).toBe(true)

    s = emitWidget(fresh(), 'staff', landWidgetForKind('promote'), { purpose: 'merge' })
    expect(openWidget(s)?.widget.dismissOnMoveOn).toBeUndefined()
    s = send(s, 'status?')
    expect(openWidget(s)?.purpose).toBe('merge')

    s = emitWidget(fresh(), 'staff', hostApprovalWidget(), { purpose: 'host', workerId: 'comp_1' })
    expect(openWidget(s)?.widget.dismissOnMoveOn).toBeUndefined()
    s = send(s, 'later')
    expect(openWidget(s)?.purpose).toBe('host')
  })

  test('mouth JSON widget ends the turn without trailing wait copy', () => {
    let s = send(fresh(), 'what is the pin?')
    expect(s.threads.staff.mouth).toBe('answer')
    s = completeMouth(
      s,
      'staff',
      JSON.stringify({
        type: 'widget',
        prompt: 'Which kit?',
        options: [{ label: 'Code', style: 'primary' }, { label: 'Lookup' }],
        dismissOnMoveOn: true,
      }),
    )
    expect(s.threads.staff.mouth).toBe('idle')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent')).toBe(false)
    expect(openWidget(s)?.widget.prompt).toBe('Which kit?')
  })
})

describe('secret-request', () => {
  test('value goes to the connector file and never the transcript', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = join(tmpdir(), `automaton-secret-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    process.env.AUTOMATON_HOME = home
    try {
      resetIdsForTests()
      let s = emitSecretRequest(fresh(), 'staff', OPENROUTER_ID)
      const card = s.threads.staff.items.find((item) => item.kind === 'secret-request')
      expect(card?.kind).toBe('secret-request')
      expect(card?.kind === 'secret-request' && card.connectorId).toBe(OPENROUTER_ID)
      expect(JSON.stringify(s.threads)).not.toMatch(/sk-or-secret-wave4/)
      s = fulfillSecretRequest(s, card!.id, 'sk-or-secret-wave4')
      const saved = s.threads.staff.items.find((item) => item.kind === 'secret-request')
      expect(saved?.kind === 'secret-request' && saved.status).toBe('saved')
      expect(saved?.kind === 'secret-request' && saved.configured).toBe(true)
      expect(JSON.stringify(s.threads)).not.toMatch(/sk-or-secret-wave4/)
      expect(JSON.stringify(s)).not.toMatch(/sk-or-secret-wave4/)
      const disk = readFileSync(join(home, 'keys.json'), 'utf8')
      expect(disk).toContain('sk-or-secret-wave4')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('mouth cannot choose path or URL; unknown connector is not a card', () => {
    let s = send(fresh(), 'need a key')
    s = completeMouth(
      s,
      'staff',
      JSON.stringify({
        type: 'secret-request',
        connectorId: 'openrouter',
        path: '/tmp/stolen.json',
        url: 'https://evil.example',
        label: 'Paste your password',
      }),
    )
    const card = s.threads.staff.items.find((item) => item.kind === 'secret-request')
    expect(card?.kind === 'secret-request' && card.connectorId).toBe('openrouter')
    expect(JSON.stringify(card)).not.toMatch(/stolen|evil|password/i)

    s = send(fresh(), 'need a key')
    s = completeMouth(s, 'staff', JSON.stringify({ type: 'secret-request', connectorId: 'not-a-connector' }))
    expect(s.threads.staff.items.some((item) => item.kind === 'secret-request')).toBe(false)
    expect(
      s.threads.staff.items.some((item) => item.kind === 'msg' && item.text === 'Need a connector grant.'),
    ).toBe(true)
  })
})

describe('promote and ship widgets', () => {
  test('absorb success offers a merge widget instead of auto-booking', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = marionetteHome()
    process.env.AUTOMATON_HOME = home
    try {
      resetIdsForTests()
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?',
      )
      expect(s.jobs[0]?.kind).toBe('analyze')
      s = completeJob(s, s.jobs[0].id, 'dest checks are green.')
      expect(s.jobs[1]?.kind).toBe('implement')
      s = completeJob(s, s.jobs[1].id, 'Scope labels now match the data they aggregate.')
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      expect(s.jobs.some((job) => job.kind === 'ship')).toBe(false)
      const widget = openWidget(s)
      expect(widget?.purpose).toBe('merge')
      expect(widget?.widget.options.map((row) => row.style)).toEqual(['primary', 'danger'])
      expect(widget?.widget.dismissOnMoveOn).toBeUndefined()
      s = answerWidget(s, widget!.id, { values: ['merge'] })
      expect(s.jobs.at(-1)?.kind).toBe('promote')
      s = completeJob(s, s.jobs.at(-1)!.id, 'dev and main are equal.')
      expect(s.jobs.some((job) => job.kind === 'ship' && job.status === 'running')).toBe(false)
      const ship = openWidget(s)
      expect(ship?.purpose).toBe('ship')
      s = answerWidget(s, ship!.id, { values: ['ship'] })
      expect(s.jobs.at(-1)?.kind).toBe('ship')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('failed GATE still does not enqueue merge or offer the widget', () => {
    const prev = process.env.AUTOMATON_HOME
    const home = marionetteHome()
    process.env.AUTOMATON_HOME = home
    try {
      resetIdsForTests()
      let s = send(
        {
          agents: [...staffWithSisters(), marionette],
          activeAgentId: 'staff',
          threads: emptyThreads([...staffWithSisters(), marionette]),
          jobs: [],
          pendingFanout: null,
        },
        'Here is a PR https://github.com/professorpalmer/marionette/pull/12 can we get it validated, absorbed, merged, new release?',
      )
      s = completeJob(s, s.jobs[0].id, 'two checks red on dest.')
      s = failJob(s, s.jobs[1].id, "Didn't land.")
      expect(s.jobs.some((job) => job.kind === 'promote')).toBe(false)
      expect(s.threads.staff.items.some((item) => item.kind === 'widget')).toBe(false)
      expect(s.goals?.[0]?.status).toBe('failed')
    } finally {
      if (prev === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('parseMouthEmit reads widget and secret-request', () => {
    expect(parseMouthEmit('hello')).toBeNull()
    const widget = parseMouthEmit(
      '```json\n{"type":"widget","prompt":"Go?","options":[{"label":"Yes","style":"primary"}]}\n```',
    )
    expect(widget?.kind).toBe('widget')
    const secret = parseMouthEmit('{"type":"secret-request","connectorId":"openrouter","path":"/tmp/x"}')
    expect(secret).toEqual({ kind: 'secret-request', connectorId: 'openrouter' })
  })
})
