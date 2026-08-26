import { describe, expect, test } from 'bun:test'
import { watchPasteHotkey } from '../src/runtime/paste-hotkey'

describe('paste hotkey', () => {
  test('fires once on cmd-v edge while frontmost', () => {
    let down = false
    let n = 0
    const ticks: Array<() => void> = []
    const stop = watchPasteHotkey(
      () => {
        n += 1
      },
      {
        cmdV: () => down,
        frontmost: () => true,
        setInterval: (fn) => {
          ticks.push(fn as () => void)
          return 1 as unknown as ReturnType<typeof setInterval>
        },
        clearInterval: () => {},
      },
    )
    ticks[0]?.()
    expect(n).toBe(0)
    down = true
    ticks[0]?.()
    ticks[0]?.()
    expect(n).toBe(1)
    down = false
    ticks[0]?.()
    down = true
    ticks[0]?.()
    expect(n).toBe(2)
    stop()
  })

  test('ignores cmd-v when another app is frontmost', () => {
    let n = 0
    const ticks: Array<() => void> = []
    watchPasteHotkey(
      () => {
        n += 1
      },
      {
        cmdV: () => true,
        frontmost: () => false,
        setInterval: (fn) => {
          ticks.push(fn as () => void)
          return 1 as unknown as ReturnType<typeof setInterval>
        },
        clearInterval: () => {},
      },
    )
    ticks[0]?.()
    expect(n).toBe(0)
  })
})
