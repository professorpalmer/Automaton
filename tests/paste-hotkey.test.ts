import { describe, expect, test } from 'bun:test'
import { cmdQuitDown, watchPasteHotkey, watchQuitHotkey } from '../src/runtime/paste-hotkey'

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

  test('cmdQuitDown is cmd+q without shift or option', () => {
    const keys = new Set<number>()
    const read = (_state: number, key: number) => keys.has(key)
    keys.add(55)
    keys.add(12)
    expect(cmdQuitDown(read)).toBe(true)
    keys.add(56)
    expect(cmdQuitDown(read)).toBe(false)
  })

  test('fires once on cmd-q edge while frontmost', () => {
    let down = false
    let n = 0
    const ticks: Array<() => void> = []
    const stop = watchQuitHotkey(
      () => {
        n += 1
      },
      {
        cmdQuit: () => down,
        frontmost: () => true,
        setInterval: (fn) => {
          ticks.push(fn as () => void)
          return 1 as unknown as ReturnType<typeof setInterval>
        },
        clearInterval: () => {},
      },
    )
    down = true
    ticks[0]?.()
    ticks[0]?.()
    expect(n).toBe(1)
    stop()
  })
})
