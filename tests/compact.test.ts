import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENTS, emptyThreads, resetIdsForTests } from '../src/domain'
import {
  applyCompact,
  cachePrefixText,
  compactRequestMessages,
  COMPACT_CHAR_BUDGET,
  COMPACT_FAIL_COOLDOWN_MS,
  COMPACT_INSTRUCTIONS,
  COMPACT_KEEP_TAIL,
  COMPACT_MIN_MIDDLE,
  COMPACT_MODEL,
  COMPACT_SUMMARY_PREFIX,
  formatCompactSummary,
  isCompactSummaryTurn,
  markCompactFail,
  middleFingerprint,
  prefixHasVolatile,
  resetCompactForTests,
  runCompact,
  SCREENSHOT_PRUNE_EVERY,
  shouldCompact,
  shouldPruneScreenshots,
  splitPrefixAndTail,
  stableToolsJson,
  withCacheBreakpoint,
  workingSetChars,
} from '../src/runtime/compact.ts'
import { prefixHasTimestamp, prefixHasVolatile as computerPrefixVolatile, stableComputerPrefix } from '../src/runtime/computer-tools.ts'
import { OPENROUTER_COMPUTER_TOOLS } from '../src/runtime/computer-worker.ts'
import { buildWorkingSet, type ChatTurn } from '../src/runtime/working-set.ts'

function big(n: number): ChatTurn[] {
  const messages: ChatTurn[] = [
    { role: 'system', content: 'You are Staff. Speak briefly.' },
  ]
  for (let i = 0; i < n; i += 1) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `block ${i} ${'x'.repeat(2000)}` })
  }
  return messages
}

describe('cache-stable compaction', () => {
  test('prefix has no timestamps or UUIDs', () => {
    resetIdsForTests()
    const messages = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread: emptyThreads(DEFAULT_AGENTS).staff,
      claims: [{ ownerAgentId: 'kernel', text: 'The ledger replay is deterministic.' }],
      kit: 'coordinator',
      roster: DEFAULT_AGENTS,
      model: 'openai/gpt-4o-mini',
      projects: [],
      query: 'what did Kernel find',
    })
    const prefix = cachePrefixText(messages)
    expect(prefix.length).toBeGreaterThan(20)
    expect(prefixHasVolatile(prefix)).toBe(false)
    expect(prefixHasTimestamp(prefix)).toBe(false)
    expect(prefix).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    const computer = stableComputerPrefix({ agentName: 'Kernel', display: 2, goal: 'open example.com at 2026-08-27T07:00:00.000Z' })
    expect(computerPrefixVolatile(computer)).toBe(false)
    expect(computer).not.toContain('2026-08-27')
    expect(computer).not.toContain('open example.com')
  })

  test('system prompt stays cache-identical across turns', () => {
    resetIdsForTests()
    const thread = emptyThreads(DEFAULT_AGENTS).staff
    const a = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread,
      claims: [],
      kit: 'coordinator',
      roster: DEFAULT_AGENTS,
      model: 'openai/gpt-4o-mini',
      projects: [],
      query: 'hello there',
    })
    thread.items = [
      { kind: 'msg', id: 'item_1', from: 'user', agentId: 'staff', text: 'hello there' },
      { kind: 'msg', id: 'item_2', from: 'agent', agentId: 'staff', text: 'Chief of Staff.' },
    ]
    const b = buildWorkingSet({
      agent: DEFAULT_AGENTS[0],
      thread,
      claims: [{ ownerAgentId: 'kernel', text: 'later claim' }],
      kit: 'coordinator',
      roster: DEFAULT_AGENTS,
      model: 'openai/gpt-4o-mini',
      projects: [],
      query: 'what next',
    })
    expect(cachePrefixText(a)).toBe(cachePrefixText(b))
    expect(a[0]?.content).toBe(b[0]?.content)
    const { prefix, tail } = splitPrefixAndTail(b)
    expect(prefix).toHaveLength(1)
    expect(JSON.stringify(tail)).toContain('later claim')
    expect(JSON.stringify(prefix)).not.toContain('later claim')
  })

  test('compact preserves the system prompt and pins code paths', () => {
    const messages = big(20)
    expect(shouldCompact(messages)).toBe(true)
    expect(workingSetChars(messages)).toBeGreaterThan(COMPACT_CHAR_BUDGET)
    const request = compactRequestMessages(messages)
    expect(request?.[0]?.content).toBe(messages[0]?.content)
    expect(JSON.stringify(request)).toContain(COMPACT_INSTRUCTIONS)
    expect(COMPACT_INSTRUCTIONS).toContain('file paths')
    expect(COMPACT_INSTRUCTIONS).toContain('decisions')
    expect(COMPACT_INSTRUCTIONS).toContain('verbatim quotes')
    expect(COMPACT_MODEL).toBe('openai/gpt-4o-mini')
    const compacted = applyCompact(messages, 'Kept src/runtime/mouth.ts. Decision: cache the system prefix.')
    expect(compacted[0]?.content).toBe(messages[0]?.content)
    expect(JSON.stringify(compacted)).toContain('src/runtime/mouth.ts')
    expect(compacted.length).toBeLessThan(messages.length)
    expect(isCompactSummaryTurn(compacted[1]!)).toBe(true)
    expect(String(compacted[1]?.content)).toContain(COMPACT_SUMMARY_PREFIX)
  })

  test('honesty banner marks summarized vs verbatim-recent', () => {
    expect(formatCompactSummary('Pinned mouth.ts')).toBe(
      `${COMPACT_SUMMARY_PREFIX}\nPinned mouth.ts`,
    )
    const messages = big(12)
    const compacted = applyCompact(messages, 'Pinned mouth.ts')
    expect(COMPACT_KEEP_TAIL).toBe(4)
    expect(COMPACT_MIN_MIDDLE).toBe(2)
    const summary = compacted.find(isCompactSummaryTurn)
    expect(summary).toBeTruthy()
    const after = compacted.slice(compacted.indexOf(summary!) + 1)
    expect(after.length).toBe(COMPACT_KEEP_TAIL)
    expect(after.every((row) => !isCompactSummaryTurn(row))).toBe(true)
  })

  test('runCompact fail-soft keeps prior set and cooldown skips re-hit', async () => {
    resetCompactForTests()
    const messages = big(20)
    const fail = await runCompact(
      messages,
      async () => {
        throw new Error('openrouter 500')
      },
      'sk-test',
    )
    expect(fail.status).toBe('failed')
    if (fail.status !== 'failed') throw new Error('expected failed')
    expect(fail.messages).toBe(messages)
    markCompactFail(1_000)
    const skipped = await runCompact(
      messages,
      async () => 'should not run',
      'sk-test',
      { now: 1_000 + COMPACT_FAIL_COOLDOWN_MS - 1 },
    )
    expect(skipped.status).toBe('skipped')
    let calls = 0
    const ok = await runCompact(
      messages,
      async () => {
        calls += 1
        return 'Kept paths.'
      },
      'sk-test',
      { now: 1_000 + COMPACT_FAIL_COOLDOWN_MS + 1 },
    )
    expect(ok.status).toBe('compacted')
    expect(calls).toBe(1)
    const fp = middleFingerprint(messages)
    const again = await runCompact(
      messages,
      async () => {
        calls += 1
        return 'again'
      },
      'sk-test',
      { now: 1_000 + COMPACT_FAIL_COOLDOWN_MS + 2 },
    )
    expect(again.status).toBe('skipped')
    expect(calls).toBe(1)
    expect(fp).toBe(middleFingerprint(messages))
  })

  test('force Compact now bypasses char budget when middle exists', async () => {
    resetCompactForTests()
    const messages: ChatTurn[] = [
      { role: 'system', content: 'You are Staff.' },
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
      { role: 'user', content: 'five' },
      { role: 'assistant', content: 'six' },
    ]
    expect(shouldCompact(messages)).toBe(false)
    expect(shouldCompact(messages, COMPACT_CHAR_BUDGET, { force: true })).toBe(true)
    const forced = await runCompact(
      messages,
      async () => 'Short summary of earlier turns.',
      'sk-test',
      { force: true },
    )
    expect(forced.status).toBe('compacted')
    if (forced.status !== 'compacted') throw new Error('expected compacted')
    expect(forced.messages.length).toBeLessThan(messages.length)
    expect(JSON.stringify(forced.messages)).toContain(COMPACT_SUMMARY_PREFIX)
  })

  test('OpenRouter breakpoint sits on the system prefix; tools JSON stays ordered', () => {
    const messages: ChatTurn[] = [
      { role: 'system', content: 'You are Staff.' },
      { role: 'user', content: 'hi' },
    ]
    const wire = withCacheBreakpoint(messages)
    const first = wire[0]?.content
    expect(Array.isArray(first)).toBe(true)
    if (!Array.isArray(first) || first[0]?.type !== 'text') throw new Error('missing text part')
    expect(first[0].text).toBe('You are Staff.')
    expect('cache_control' in first[0] && first[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(JSON.stringify(first[0])).not.toMatch(/ttl|timestamp|uuid/i)
    const tools = stableToolsJson(OPENROUTER_COMPUTER_TOOLS)
    expect(tools).toBe(stableToolsJson(OPENROUTER_COMPUTER_TOOLS))
    expect(tools).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(OPENROUTER_COMPUTER_TOOLS.map((row) => row.function.name)).toEqual([
      'box_shell',
      'box_read',
      'box_screenshot',
      'box_browser',
      'box_computer',
      'operator_help',
      'copy_in',
      'copy_out',
      'host_read',
      'host_shell',
    ])
  })

  test('screenshot prune cadence is every 25 turns, not every turn', () => {
    expect(SCREENSHOT_PRUNE_EVERY).toBe(25)
    expect(shouldPruneScreenshots(1)).toBe(false)
    expect(shouldPruneScreenshots(24)).toBe(false)
    expect(shouldPruneScreenshots(25)).toBe(true)
    expect(shouldPruneScreenshots(49)).toBe(false)
    expect(shouldPruneScreenshots(50)).toBe(true)
  })
})
