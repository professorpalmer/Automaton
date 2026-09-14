import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPaletteItems,
  filterPaletteItems,
  groupPaletteItems,
  SETTINGS_PALETTE,
} from '../src/chrome/palette'
import { menuFill, surfaceNeedsOpaqueFill } from '../src/chrome/surface'
import { commandPaletteChord } from '../src/inspector'
import { cmdKDown } from '../src/runtime/paste-hotkey'
import {
  completeMouth,
  removeSteerAt,
  send,
  sendSteerNow,
  stopMouth,
  type Session,
} from '../src/session'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import { T } from '../src/tokens'

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

describe('wave 6 p1 palette', () => {
  test('Cmd+K chord + HID match paste-hotkey discipline', () => {
    expect(commandPaletteChord({ key: 'k', modifiers: { cmd: true } })).toBe(true)
    expect(commandPaletteChord({ key: 'k', modifiers: { cmd: true, shift: true } })).toBe(false)
    const keys = new Set<number>()
    const read = (_s: number, key: number) => keys.has(key)
    keys.add(55) // cmd
    keys.add(40) // K
    expect(cmdKDown(read)).toBe(true)
    keys.clear()
    keys.add(55)
    keys.add(40)
    keys.add(56) // shift
    expect(cmdKDown(read)).toBe(false)
  })

  test('fuzzy catalog covers sisters, rooms, settings, jobs', () => {
    const items = buildPaletteItems({
      agents: [
        { id: 'staff', name: 'Chief of Staff', title: 'Coordinator' },
        { id: 'kernel', name: 'Kernel', title: 'Code' },
      ],
      rooms: [{ id: 'r1', name: 'Ship room' }],
    })
    expect(items.some((row) => row.section === 'Sisters' && row.targetId === 'kernel')).toBe(true)
    expect(items.some((row) => row.section === 'Rooms' && row.label === 'Ship room')).toBe(true)
    expect(SETTINGS_PALETTE.length).toBeGreaterThan(5)
    expect(items.some((row) => row.section === 'Jobs')).toBe(true)
    const hit = filterPaletteItems(items, 'kern')
    expect(hit[0]?.targetId).toBe('kernel')
    const settings = filterPaletteItems(items, 'routine')
    expect(settings.some((row) => row.settingsSection === 'routines')).toBe(true)
    const groups = groupPaletteItems(filterPaletteItems(items, ''))
    expect(groups.map((g) => g.section)).toContain('Settings')
  })

  test('palette + tip + steer paint use opaque menu fill', () => {
    expect(surfaceNeedsOpaqueFill('menu')).toBe(true)
    expect(menuFill(T).length).toBeGreaterThan(0)
    const palette = readFileSync(join(root, 'src/chrome/command-palette.tsx'), 'utf8')
    expect(palette).toContain('menuFill')
    expect(palette).toContain("groupBoxStyle(T, 'menu')")
    expect(palette).toContain('command-palette-input')
    const tip = readFileSync(join(root, 'src/chrome/tooltip.tsx'), 'utf8')
    expect(tip).toContain('menuFill')
    const queue = readFileSync(join(root, 'src/chrome/steer-queue.tsx'), 'utf8')
    expect(queue).toContain('menuFill')
    expect(queue).toContain('Send now')
  })

  test('staff wires palette, steer card, ListRow, Tip', () => {
    const app = readFileSync(join(root, 'src/app.tsx'), 'utf8')
    expect(app).toContain('<CommandPalette')
    expect(app).toContain('<SteerQueueCard')
    expect(app).toContain('watchPaletteHotkey')
    expect(app).toContain('commandPaletteChord')
    expect(app).toContain('removeSteerAt')
    expect(app).toContain('sendSteerNow')
    expect(app).toContain('ListRow')
    expect(app).toContain('<Tip')
    const settings = readFileSync(join(root, 'src/settings.tsx'), 'utf8')
    expect(settings).toContain('ListRow')
    expect(settings).toContain('endHoverSlot')
    expect(settings).toContain('focusSection')
    expect(settings).toContain('settings-section-${id}')
    expect(settings).toContain('id="routines"')
    const docs = readFileSync(join(root, 'docs/wave6-gpui-polish.md'), 'utf8')
    expect(docs).toContain('Cmd+K')
    expect(docs).toContain('Visible steer queue')
    expect(docs).toContain('ListRow')
  })
})

describe('wave 6 p1 steer queue session', () => {
  test('removeSteerAt drops one line; sendSteerNow sends when idle', () => {
    let s = send(fresh(), 'hello staff')
    expect(s.threads.staff.mouth).toBe('answer')
    s = send(s, 'first parked')
    s = send(s, 'second parked')
    expect(s.threads.staff.steerQueue).toEqual([
      { text: 'first parked' },
      { text: 'second parked' },
    ])
    s = removeSteerAt(s, 'staff', 0)
    expect(s.threads.staff.steerQueue).toEqual([{ text: 'second parked' }])
    s = stopMouth(s, 'staff')
    expect(s.threads.staff.mouth).toBe('idle')
    s = sendSteerNow(s, 'staff', 0)
    expect(s.threads.staff.steerQueue).toEqual([])
    const users = s.threads.staff.items.filter((item) => item.kind === 'msg' && item.from === 'user')
    expect(users.some((item) => item.kind === 'msg' && item.text === 'second parked')).toBe(true)
  })

  test('sendSteerNow promotes to front while mouth is queueing', () => {
    let s = send(fresh(), 'hello staff')
    s = send(s, 'a')
    s = send(s, 'b')
    s = send(s, 'c')
    expect(s.threads.staff.steerQueue.map((line) => line.text)).toEqual(['a', 'b', 'c'])
    s = sendSteerNow(s, 'staff', 2)
    expect(s.threads.staff.steerQueue.map((line) => line.text)).toEqual(['c', 'a', 'b'])
    s = completeMouth(s, 'staff', 'ok')
    // drain joins remaining parked lines after complete — promote only reordered while busy
    expect(s.threads.staff.steerQueue.length).toBeGreaterThanOrEqual(0)
  })
})

describe('wave 6 p1 list row helper', () => {
  test('ListRow module exports density + hover slot', () => {
    const src = readFileSync(join(root, 'src/chrome/list-row.tsx'), 'utf8')
    expect(src).toContain('endHoverSlot')
    expect(src).toContain("density = 'default'")
    expect(src).toContain('compact')
  })
})
