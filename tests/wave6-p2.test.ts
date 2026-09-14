import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { edgeFadeBackground, rgbHex, transparentHex } from '../src/chrome/edge-fade'
import { KEYMAP, keymapByGroup, keymapChord } from '../src/chrome/keymap'
import { SETTINGS_PALETTE } from '../src/chrome/palette'
import { menuFill, surfaceNeedsOpaqueFill } from '../src/chrome/surface'
import {
  expensivePulseSurface,
  pulseDuration,
  pulseStrideFor,
  PULSE_STRIDE_S,
  PULSE_STRIDE_SLOW_S,
} from '../src/motion/pulse'
import {
  claimNotifyFocusIfFrontmost,
  OS_NOTIFY_DISABLE_ENV,
  osNotifyAllowed,
  parkPendingNotifyFocus,
  peekPendingNotifyFocus,
  postOsNotify,
  resetOsNotifyForTests,
  shouldPostBackgroundNotify,
  takePendingNotifyFocus,
} from '../src/runtime/os-notify'
import { idleParkInventory } from '../src/runtime/idle-health'
import { parseSkin } from '../src/runtime/skin'
import { T } from '../src/tokens'

const root = join(import.meta.dir, '..')

describe('wave 6 p2 os notify', () => {
  test('Quiet + kill-switch + frontmost gate; failures swallowed', () => {
    resetOsNotifyForTests()
    expect(osNotifyAllowed(false)).toBe(false)
    expect(shouldPostBackgroundNotify(false, { frontmost: () => false })).toBe(false)
    expect(shouldPostBackgroundNotify(true, { frontmost: () => true })).toBe(false)

    const prev = process.env[OS_NOTIFY_DISABLE_ENV]
    process.env[OS_NOTIFY_DISABLE_ENV] = '1'
    expect(osNotifyAllowed(true)).toBe(false)
    if (prev == null) delete process.env[OS_NOTIFY_DISABLE_ENV]
    else process.env[OS_NOTIFY_DISABLE_ENV] = prev

    // runningTests() → allowed false even when enabled
    expect(osNotifyAllowed(true)).toBe(false)

    let posted = 0
    // Force path as if not in tests by using custom seams that skip frontmost + post
    // postOsNotify still respects runningTests via osNotifyAllowed — expect false
    expect(
      postOsNotify(
        { title: 'Kernel', body: 'Done.', agentId: 'kernel' },
        { enabled: true, frontmost: () => false, post: () => {
          posted += 1
        } },
      ),
    ).toBe(false)
    expect(posted).toBe(0)
  })

  test('pending focus parks sister id and claims when frontmost', () => {
    resetOsNotifyForTests()
    // Manually park (post is test-gated)
    parkPendingNotifyFocus('kernel')
    expect(peekPendingNotifyFocus()).toBe('kernel')
    expect(claimNotifyFocusIfFrontmost({ frontmost: () => false })).toBe(null)
    expect(peekPendingNotifyFocus()).toBe('kernel')
    expect(claimNotifyFocusIfFrontmost({ frontmost: () => true })).toBe('kernel')
    expect(takePendingNotifyFocus()).toBe(null)
  })

  test('skin + settings + app wire Background notify', () => {
    expect(parseSkin({}).osNotifyBackground).toBe(false)
    expect(parseSkin({ osNotifyBackground: true }).osNotifyBackground).toBe(true)
    const settings = readFileSync(join(root, 'src/settings.tsx'), 'utf8')
    expect(settings).toContain('settings-os-notify')
    expect(settings).toContain('Quiet')
    expect(settings).toContain('AUTOMATON_DISABLE_NOTIFICATIONS')
    const app = readFileSync(join(root, 'src/app.tsx'), 'utf8')
    expect(app).toContain('postOsNotify')
    expect(app).toContain('claimNotifyFocusIfFrontmost')
    expect(app).toContain('osNotifyBackground')
  })
})

describe('wave 6 p2 pulse lease strides', () => {
  test('default vs slow duration; expensive surface heuristic', () => {
    expect(pulseDuration('default')).toBe(PULSE_STRIDE_S)
    expect(pulseDuration('slow')).toBe(PULSE_STRIDE_SLOW_S)
    expect(expensivePulseSurface({ feedLen: 10 })).toBe(false)
    expect(expensivePulseSurface({ feedLen: 40 })).toBe(true)
    expect(expensivePulseSurface({ activityOpen: true })).toBe(true)
    expect(pulseStrideFor({ feedLen: 5 })).toBe('default')
    expect(pulseStrideFor({ feedLen: 50, activityOpen: true })).toBe('slow')
  })

  test('MouthWaitBubble + ActivityZone take stride; parks documented', () => {
    const mouth = readFileSync(join(root, 'src/chrome/mouth-wait.tsx'), 'utf8')
    expect(mouth).toContain('pulseDuration')
    expect(mouth).toContain('stride')
    const activity = readFileSync(join(root, 'src/chrome/activity-zone.tsx'), 'utf8')
    expect(activity).toContain('pulseStride')
    expect(activity).toContain('activity-pulse')
    const parks = idleParkInventory().map((row) => row.id)
    expect(parks).toContain('pulse-stride')
    expect(parks).toContain('os-notify-focus')
  })
})

describe('wave 6 p2 edge fade spike', () => {
  test('two-stop gradient helpers + feed wrap; opaque overlays untouched', () => {
    expect(rgbHex('#10101009')).toBe('#101010')
    expect(transparentHex('#ABCDEFaa')).toBe('#ABCDEF00')
    const top = edgeFadeBackground('#101010', 'top')
    expect(top.type).toBe('linear-gradient')
    expect(top.angle).toBe(180)
    expect(top.stops[0].color).toBe('#101010')
    expect(top.stops[1].color).toBe('#10101000')
    const app = readFileSync(join(root, 'src/app.tsx'), 'utf8')
    expect(app).toContain('EdgeFadeFrame')
    expect(app).toContain('feed-edge-fade')
    expect(surfaceNeedsOpaqueFill('menu')).toBe(true)
    expect(menuFill(T).length).toBeGreaterThan(0)
  })
})

describe('wave 6 p2 shortcuts help', () => {
  test('KEYMAP drives help — not stale markdown alone', () => {
    expect(KEYMAP.length).toBeGreaterThanOrEqual(10)
    expect(keymapChord('palette')).toBe('Cmd+K')
    expect(keymapChord('focus-composer')).toBe('Cmd+L')
    const groups = keymapByGroup()
    expect(groups.map((g) => g.group)).toEqual(['Focus', 'Chrome', 'Edit', 'App'])
    expect(SETTINGS_PALETTE.some((row) => row.id === 'shortcuts')).toBe(true)
    const settings = readFileSync(join(root, 'src/settings.tsx'), 'utf8')
    expect(settings).toContain('ShortcutsHelp')
    expect(settings).toContain('id="shortcuts"')
    const help = readFileSync(join(root, 'src/chrome/shortcuts-help.tsx'), 'utf8')
    expect(help).toContain('keymapByGroup')
    const docs = readFileSync(join(root, 'docs/wave6-gpui-polish.md'), 'utf8')
    expect(docs).toContain('KEYMAP')
  })
})
