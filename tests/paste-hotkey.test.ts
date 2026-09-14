import { describe, expect, test } from 'bun:test'
import { cmdADown, cmdBDown, cmdCDown, cmdJDown, cmdKDown, cmdLDown, cmdCommaDown, cmdQuitDown, cmdXDown, watchCopyHotkey, watchFocusComposerHotkey, watchPasteHotkey, watchQuitHotkey, watchSelectAllHotkey } from '../src/runtime/paste-hotkey'

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

describe('focus chords (wave 6 p0)', () => {
  test('cmdL / cmdB / cmdComma / cmdJ / cmdK without shift', () => {
    const keys = new Set<number>()
    const read = (_state: number, key: number) => keys.has(key)
    keys.add(55)
    keys.add(37)
    expect(cmdLDown(read)).toBe(true)
    keys.add(56)
    expect(cmdLDown(read)).toBe(false)
    keys.delete(56)
    keys.delete(37)
    keys.add(11)
    expect(cmdBDown(read)).toBe(true)
    keys.delete(11)
    keys.add(43)
    expect(cmdCommaDown(read)).toBe(true)
    keys.delete(43)
    keys.add(38)
    expect(cmdJDown(read)).toBe(true)
    keys.delete(38)
    keys.add(40)
    expect(cmdKDown(read)).toBe(true)
  })

  test('watchFocusComposerHotkey fires once on edge', () => {
    let down = false
    let n = 0
    const ticks: Array<() => void> = []
    const stop = watchFocusComposerHotkey(
      () => {
        n += 1
      },
      {
        cmdL: () => down,
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
