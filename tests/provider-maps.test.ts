import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProviderReasoningControls } from '../src/runtime/provider-maps'
import { chatOpenRouter } from '../src/runtime/mouth'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-maps-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('provider maps', () => {
  test('grok max -> xhigh; grok fast -> low; grok never writes thinking:none', () => {
    const maxBody: Record<string, unknown> = { model: 'grok-4' }
    expect(applyProviderReasoningControls(maxBody, { modelId: 'grok-4', maxMode: true })).toBe('grok')
    expect(maxBody.reasoning_effort).toBe('xhigh')
    expect(maxBody).not.toHaveProperty('thinking')

    const effortMax: Record<string, unknown> = { model: 'x-ai/grok-4' }
    expect(
      applyProviderReasoningControls(effortMax, { modelId: 'x-ai/grok-4', effort: 'max' }),
    ).toBe('grok')
    expect(effortMax.reasoning_effort).toBe('xhigh')
    expect(effortMax).not.toHaveProperty('thinking')

    const fastBody: Record<string, unknown> = { model: 'grok-4' }
    expect(applyProviderReasoningControls(fastBody, { modelId: 'grok-4', fast: true })).toBe('grok')
    expect(fastBody.reasoning_effort).toBe('low')
    expect(JSON.stringify(fastBody)).not.toContain('none')
    expect(fastBody).not.toHaveProperty('thinking')

    const silent: Record<string, unknown> = { model: 'grok-4' }
    applyProviderReasoningControls(silent, { modelId: 'grok-4', thinking: false })
    expect(silent).not.toHaveProperty('thinking')
    expect(JSON.stringify(silent)).not.toMatch(/thinking"?\s*:\s*"?none/)
  })

  test('glm fast / thinking false -> thinking.disabled', () => {
    const fast: Record<string, unknown> = { model: 'glm-5.3-flash' }
    expect(applyProviderReasoningControls(fast, { modelId: 'glm-5.3-flash', fast: true })).toBe(
      'glm-fast-off',
    )
    expect(fast.thinking).toEqual({ type: 'disabled' })

    const off: Record<string, unknown> = { model: 'glm-5.3-flash' }
    expect(
      applyProviderReasoningControls(off, { modelId: 'glm-5.3-flash', thinking: false }),
    ).toBe('glm-thinking-off')
    expect(off.thinking).toEqual({ type: 'disabled' })
  })

  test('glm bare (no params) -> body unchanged', () => {
    const body: Record<string, unknown> = { model: 'glm-5.3-flash', max_tokens: 2048 }
    const before = JSON.stringify(body)
    expect(applyProviderReasoningControls(body, { modelId: 'glm-5.3-flash' })).toBe('glm-passthrough')
    expect(JSON.stringify(body)).toBe(before)
  })

  test('gemini-3.6-flash high -> model suffix; gemini-2.0-flash untouched', () => {
    const flash: Record<string, unknown> = { model: 'gemini-3.6-flash' }
    expect(
      applyProviderReasoningControls(flash, { modelId: 'gemini-3.6-flash', effort: 'high' }),
    ).toBe('gemini-slug')
    expect(flash.model).toBe('gemini-3.6-flash-high')

    const older: Record<string, unknown> = { model: 'gemini-2.0-flash' }
    const before = JSON.stringify(older)
    expect(
      applyProviderReasoningControls(older, { modelId: 'gemini-2.0-flash', effort: 'high' }),
    ).toBe('gemini-passthrough')
    expect(JSON.stringify(older)).toBe(before)
  })

  test('deepseek:thinking enables thinking object', () => {
    const slug: Record<string, unknown> = { model: 'deepseek-chat:thinking' }
    expect(
      applyProviderReasoningControls(slug, { modelId: 'deepseek-chat:thinking' }),
    ).toBe('deepseek-thinking')
    expect(slug.thinking).toEqual({ type: 'enabled' })
    expect(slug.reasoning_effort).toBe('high')
    expect(slug.max_tokens).toBe(256000)

    const optIn: Record<string, unknown> = { model: 'deepseek-chat', max_tokens: 2048 }
    expect(
      applyProviderReasoningControls(optIn, { modelId: 'deepseek-chat', thinking: true }),
    ).toBe('deepseek-thinking')
    expect(optIn.thinking).toEqual({ type: 'enabled' })
    expect(optIn.reasoning_effort).toBe('high')
    expect(optIn.max_tokens).toBe(2048)
  })

  test('unknown model -> none, body unchanged', () => {
    const body: Record<string, unknown> = { model: 'openai/gpt-4o-mini', max_tokens: 2048 }
    const before = JSON.stringify(body)
    expect(applyProviderReasoningControls(body, { modelId: 'openai/gpt-4o-mini' })).toBe('none')
    expect(JSON.stringify(body)).toBe(before)
  })

  test('chatOpenRouter fail does not retry a different model', async () => {
    const home = tmpHome()
    const seen: string[] = []
    let calls = 0
    let thrown = ''
    try {
      await chatOpenRouter([{ role: 'user', content: 'hi' }], 'sk-or-test', 'x-ai/grok-4', {
        home,
        map: { maxMode: true },
        fetch: async (_input, init) => {
          calls += 1
          const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
          seen.push(String(body.model ?? ''))
          return new Response('nope', { status: 500 })
        },
      })
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }
    expect(thrown).toBe('openrouter 500')
    expect(calls).toBe(1)
    expect(seen).toEqual(['x-ai/grok-4'])
    rmSync(home, { recursive: true, force: true })
  })
})
