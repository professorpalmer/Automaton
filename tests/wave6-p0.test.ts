import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toggleRailWidth, railIsCompact, parseSkin } from '../src/runtime/skin'
import { DEFAULT_TOKENS } from '../src/theme/tokens'
import {
  focusComposerChord,
  toggleRailChord,
  settingsChord,
  jobsChord,
} from '../src/inspector'
import { cmdBDown, cmdJDown, cmdLDown, cmdCommaDown } from '../src/runtime/paste-hotkey'
import { surfaceNeedsOpaqueFill, menuFill } from '../src/chrome/surface'
import { T } from '../src/tokens'

const root = join(import.meta.dir, '..')

describe('wave 6 p0 polish', () => {
  test('focus chords match paste-hotkey discipline', () => {
    expect(focusComposerChord({ key: 'l', modifiers: { cmd: true } })).toBe(true)
    expect(toggleRailChord({ key: 'b', modifiers: { cmd: true } })).toBe(true)
    expect(settingsChord({ key: ',', modifiers: { cmd: true } })).toBe(true)
    expect(jobsChord({ key: 'j', modifiers: { cmd: true } })).toBe(true)
    expect(focusComposerChord({ key: 'l', modifiers: { cmd: true, shift: true } })).toBe(false)
    const keys = new Set<number>()
    const read = (_s: number, key: number) => keys.has(key)
    keys.add(55) // cmd
    keys.add(37) // L
    expect(cmdLDown(read)).toBe(true)
    keys.clear()
    keys.add(55)
    keys.add(11) // B
    expect(cmdBDown(read)).toBe(true)
    keys.clear()
    keys.add(55)
    keys.add(43) // comma
    expect(cmdCommaDown(read)).toBe(true)
    keys.clear()
    keys.add(55)
    keys.add(38) // J
    expect(cmdJDown(read)).toBe(true)
  })

  test('toggle rail flips compact ↔ default', () => {
    const min = DEFAULT_TOKENS.layout.sidebarMin
    const mid = DEFAULT_TOKENS.layout.sidebarWidth
    expect(railIsCompact(min)).toBe(true)
    expect(toggleRailWidth(min)).toBe(mid)
    expect(railIsCompact(toggleRailWidth(mid))).toBe(true)
    expect(parseSkin({ railWidth: toggleRailWidth(mid) }).railWidth).toBe(min)
  })

  test('toast paint uses opaque menu fill recipe', () => {
    expect(surfaceNeedsOpaqueFill('menu')).toBe(true)
    expect(menuFill(T).length).toBeGreaterThan(0)
    const toast = readFileSync(join(root, 'src/chrome/toast.tsx'), 'utf8')
    expect(toast).toContain('menuFill')
    expect(toast).toContain("groupBoxStyle(T, 'menu')")
    expect(toast).toContain('toast-stack')
  })

  test('staff wires toast stack, empty CTA, and chords', () => {
    const app = readFileSync(join(root, 'src/app.tsx'), 'utf8')
    expect(app).toContain('<ToastStack')
    expect(app).toContain('pushToast')
    expect(app).toContain('onEmptyWrite')
    expect(app).toContain('Write something')
    expect(app).toContain('focusComposerChord')
    expect(app).toContain('watchFocusComposerHotkey')
    expect(app).toContain('watchToggleRailHotkey')
    const empty = readFileSync(join(root, 'src/chrome/empty-state.tsx'), 'utf8')
    expect(empty).toContain('actionLabel')
    expect(empty).toContain('onAction')
    expect(empty).toContain('icon')
    const jobs = readFileSync(join(root, 'src/jobs-pane.tsx'), 'utf8')
    expect(jobs).toContain('Expand board')
    const docs = readFileSync(join(root, 'docs/wave6-gpui-polish.md'), 'utf8')
    expect(docs).toContain('Cmd+L')
    expect(docs).toContain('Cmd+B')
  })
})
