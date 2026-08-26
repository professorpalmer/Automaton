import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  OPENROUTER_CHAT_PATH,
  OPENROUTER_MODELS_PATH,
  connectorFetch,
  parseOpenRouterModels,
  probeConnector,
  readSseDataLine,
} from '../src/runtime/connector-client'
import {
  OPENROUTER_ID,
  OPENROUTER_ORIGIN,
  connectorStatusLabel,
  markConnected,
  readConnectors,
} from '../src/runtime/connectors'
import { chatOpenRouter } from '../src/runtime/mouth'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-conn-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('connectors', () => {
  test('default catalog is OpenRouter needing auth until marked connected', () => {
    const home = tmpHome()
    const rows = readConnectors(home)
    expect(rows[0]?.id).toBe(OPENROUTER_ID)
    expect(rows[0]?.needsAuth).toBe(true)
    expect(rows[0]?.connected).toBe(false)
    expect(rows[0]?.transport).toBe('http')
    expect(rows[0]?.baseUrl).toBe(OPENROUTER_ORIGIN)
    const next = markConnected(OPENROUTER_ID, true, home)
    expect(next[0]?.connected).toBe(true)
    expect(next[0]?.baseUrl).toBe(OPENROUTER_ORIGIN)
    rmSync(home, { recursive: true, force: true })
  })

  test('legacy catalog rows pick up transport and origin', () => {
    const home = tmpHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, 'connectors.json'),
      `${JSON.stringify([{ id: 'openrouter', name: 'OpenRouter', needsAuth: true, connected: false }], null, 2)}\n`,
    )
    const row = readConnectors(home)[0]
    expect(row?.transport).toBe('http')
    expect(row?.baseUrl).toBe(OPENROUTER_ORIGIN)
    expect(row?.lastProbeAt).toBeNull()
    expect(row?.lastError).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })

  test('probe 200 marks connected', async () => {
    const home = tmpHome()
    const seen: string[] = []
    const row = await probeConnector(OPENROUTER_ID, home, {
      now: () => 1_700_000_000_000,
      keys: () => [{ key: 'sk-or-test', source: 'automaton' }],
      fetch: async (input, init) => {
        seen.push(String(input))
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer sk-or-test')
        return new Response('{"data":[]}', { status: 200 })
      },
    })
    expect(seen).toEqual([`${OPENROUTER_ORIGIN}${OPENROUTER_MODELS_PATH}`])
    expect(row.connected).toBe(true)
    expect(row.lastError).toBeNull()
    expect(row.lastProbeAt).toBe(1_700_000_000_000)
    const disk = readFileSync(join(home, 'connectors.json'), 'utf8')
    expect(disk).not.toMatch(/sk-/)
    expect(JSON.parse(disk)[0].connected).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  test('OpenRouter catalog parses ids and names', () => {
    expect(
      parseOpenRouterModels({
        data: [
          { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
          { id: 'openai/gpt-4o-mini', name: 'dup' },
          { id: '', name: 'skip' },
          { id: 'anthropic/claude-sonnet-4' },
        ],
      }),
    ).toEqual([
      { id: 'anthropic/claude-sonnet-4', name: 'anthropic/claude-sonnet-4' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    ])
    expect(parseOpenRouterModels({})).toEqual([])
  })

  test('probe 401 is rejected and stays out of mouth copy', async () => {
    const home = tmpHome()
    const grant = 'sk-or-secret-grant-xyz'
    const row = await probeConnector(OPENROUTER_ID, home, {
      keys: () => [{ key: grant, source: 'automaton' }],
      fetch: async () => new Response('unauthorized', { status: 401 }),
    })
    expect(row.connected).toBe(false)
    expect(row.lastError).toBe('rejected')
    expect(connectorStatusLabel(row)).toBe('Rejected')
    let thrown = ''
    try {
      await chatOpenRouter(
        [{ role: 'user', content: 'hi' }],
        grant,
        'openai/gpt-4o-mini',
        {
          home,
          fetch: async () => new Response('nope', { status: 401 }),
        },
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }
    expect(thrown).toBe('openrouter 401')
    expect(thrown).not.toContain(grant)
    expect(thrown).not.toMatch(/sk-/)
    rmSync(home, { recursive: true, force: true })
  })

  test('probe network failure is unreachable', async () => {
    const home = tmpHome()
    const row = await probeConnector(OPENROUTER_ID, home, {
      keys: () => [{ key: 'sk-or-test', source: 'automaton' }],
      fetch: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(row.connected).toBe(false)
    expect(row.lastError).toBe('unreachable')
    expect(connectorStatusLabel(row)).toBe('Unreachable')
    rmSync(home, { recursive: true, force: true })
  })

  test('missing key does not probe', async () => {
    const home = tmpHome()
    let called = 0
    const row = await probeConnector(OPENROUTER_ID, home, {
      keys: () => [],
      fetch: async () => {
        called += 1
        return new Response('{"data":[]}', { status: 200 })
      },
    })
    expect(called).toBe(0)
    expect(row.connected).toBe(false)
    expect(row.lastError).toBeNull()
    expect(connectorStatusLabel(row)).toBe('Needs key')
    rmSync(home, { recursive: true, force: true })
  })

  test('mouth completions go through connectorFetch', async () => {
    const home = tmpHome()
    let url = ''
    const result = await chatOpenRouter(
      [{ role: 'user', content: 'hi' }],
      'sk-or-live',
      'openai/gpt-4o-mini',
      {
        home,
        fetch: async (input, init) => {
          url = String(input)
          const headers = new Headers(init?.headers)
          expect(headers.get('Authorization')).toBe('Bearer sk-or-live')
          expect(headers.get('X-Title')).toBe('Automaton')
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Staff.' } }],
              usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001 },
            }),
            { status: 200 },
          )
        },
      },
    )
    expect(url).toBe(`${OPENROUTER_ORIGIN}${OPENROUTER_CHAT_PATH}`)
    expect(result.text).toBe('Staff.')
    expect(result.usage).toEqual({
      promptTokens: 3,
      completionTokens: 1,
      costUsd: 0.0001,
    })
    rmSync(home, { recursive: true, force: true })
  })

  test('sse transport reads one data line', async () => {
    const home = tmpHome()
    const response = new Response('event: message\ndata: {"ok":true}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
    expect(await readSseDataLine(response)).toBe('{"ok":true}')
    const viaFetch = await connectorFetch(
      OPENROUTER_ID,
      '/api/v1/chat/completions',
      { method: 'POST', body: '{}' },
      {
        home,
        bearer: 'sk-or-sse',
        fetch: async () =>
          new Response('data: {"delta":"hi"}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      },
    )
    expect(await readSseDataLine(viaFetch)).toBe('{"delta":"hi"}')
    rmSync(home, { recursive: true, force: true })
  })
})
