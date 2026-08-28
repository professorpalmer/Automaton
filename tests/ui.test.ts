import { describe, expect, test } from 'bun:test'
import { lastItemAt, modelFamily, railClock, toneFill } from '../src/ui'
import { T } from '../src/tokens'

describe('gpuix chrome helpers', () => {
  test('model family pills stay short', () => {
    expect(modelFamily('x-ai/grok-4')).toBe('Grok')
    expect(modelFamily('z-ai/glm-4.5')).toBe('GLM')
    expect(modelFamily('anthropic/claude-sonnet-4')).toBe('Claude')
    expect(modelFamily('google/gemini-2.5-pro')).toBe('Gemini')
    expect(modelFamily('deepseek/deepseek-chat')).toBe('DeepSeek')
    expect(modelFamily('ollama/llama3')).toBe('local')
    expect(modelFamily('openai/gpt-4o-mini')).toBe('GPT')
    expect(modelFamily('')).toBe('local')
  })

  test('primary action fill is catalog violet, not a one-off hex', () => {
    expect(toneFill('action').backgroundColor).toBe(T.catalog.violet)
    expect(toneFill('action', false).backgroundColor).toBe(T.raised)
    expect(JSON.stringify(T)).toContain(T.catalog.violet)
  })

  test('rail clock is compact', () => {
    const now = Date.parse('2026-08-27T18:42:00')
    expect(railClock(now, now)).toBe('6:42 PM')
    expect(railClock(Date.parse('2026-08-26T18:42:00'), now)).toBe('Yesterday')
    expect(lastItemAt([{ at: 1 }, { at: 4 }, {}])).toBe(4)
    expect(lastItemAt([])).toBeNull()
  })
})
