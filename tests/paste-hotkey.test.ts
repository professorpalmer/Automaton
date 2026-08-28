import { describe, expect, test } from 'bun:test'
import { cmdADown, cmdCDown, cmdQuitDown, cmdXDown, watchCopyHotkey, watchPasteHotkey, watchQuitHotkey, watchSelectAllHotkey } from '../src/runtime/paste-hotkey'

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

  test('cmdCDown / cmdADown / cmdXDown are cmd plus the letter without shift', () => {
    const keys = new Set<number>()
    const read = (_state: number, key: number) => keys.has(key)
    keys.add(55)
    keys.add(8)
    expect(cmdCDown(read)).toBe(true)
    keys.add(56)
    expect(cmdCDown(read)).toBe(false)
    keys.delete(56)
    keys.delete(8)
    keys.add(0)
    expect(cmdADown(read)).toBe(true)
    keys.delete(0)
    keys.add(7)
    expect(cmdXDown(read)).toBe(true)
  })

  test('fires once on cmd-c and cmd-a edges while frontmost', () => {
    let copyDown = false
    let selectDown = false
    let copies = 0
    let selects = 0
    const copyTicks: Array<() => void> = []
    const selectTicks: Array<() => void> = []
    watchCopyHotkey(
      () => {
        copies += 1
      },
      {
        cmdC: () => copyDown,
        frontmost: () => true,
        setInterval: (fn) => {
          copyTicks.push(fn as () => void)
          return 1 as unknown as ReturnType<typeof setInterval>
        },
        clearInterval: () => {},
      },
    )
    watchSelectAllHotkey(
      () => {
        selects += 1
      },
      {
        cmdA: () => selectDown,
        frontmost: () => true,
        setInterval: (fn) => {
          selectTicks.push(fn as () => void)
          return 1 as unknown as ReturnType<typeof setInterval>
        },
        clearInterval: () => {},
      },
    )
    copyDown = true
    copyTicks[0]?.()
    copyTicks[0]?.()
    expect(copies).toBe(1)
    selectDown = true
    selectTicks[0]?.()
    expect(selects).toBe(1)
  })
})
