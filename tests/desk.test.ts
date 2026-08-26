import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { BOX_DISPLAY_H, BOX_DISPLAY_W, BOX_NAME } from '../src/runtime/computer'
import {
  captureDesk,
  clickDesk,
  deskCaptureArgv,
  deskClickArgv,
  deskKeyArgv,
  deskOpenUrlArgv,
  keyDesk,
  mapViewToDisplay,
  openDeskUrl,
  xdoButton,
  xdoKey,
} from '../src/runtime/desk'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-desk-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('mouth desk', () => {
  test('contain-fit clicks map onto the X display and miss the letterbox', () => {
    const view = { x: 10, y: 20, width: 252, height: 158 }
    const inside = mapViewToDisplay(view, { x: 10 + 126, y: 20 + 79 })
    expect(inside).not.toBeNull()
    expect(inside!.x).toBeGreaterThan(500)
    expect(inside!.x).toBeLessThan(800)
    expect(inside!.y).toBeGreaterThan(300)
    expect(inside!.y).toBeLessThan(500)
    const wide = { x: 0, y: 0, width: 400, height: 100 }
    const letterbox = mapViewToDisplay(wide, { x: 2, y: 50 })
    expect(letterbox).toBeNull()
    const hit = mapViewToDisplay(wide, { x: 200, y: 50 })
    expect(hit).not.toBeNull()
    expect(hit!.y).toBeGreaterThanOrEqual(0)
    expect(hit!.y).toBeLessThan(BOX_DISPLAY_H)
  })

  test('desk argv is docker exec plus xwd/xdotool, never noVNC', () => {
    const home = tmpHome()
    const capture = deskCaptureArgv('staff', home).join(' ')
    expect(capture).toContain(BOX_NAME)
    expect(capture).toContain('DISPLAY=:1')
    expect(capture).toContain('xwd')
    expect(capture).not.toContain('novnc')
    expect(capture).not.toContain('anyrun')
    const click = deskClickArgv('staff', { x: 40, y: 80 }, 0, home).join(' ')
    expect(click).toContain('xdotool')
    expect(click).toContain('mousemove --sync')
    expect(click).toContain('40')
    expect(click).toContain('click')
    expect(click).toContain('1')
    expect(click).not.toContain('windowactivate --sync')
    expect(deskKeyArgv('staff', 'Return', home).join(' ')).toContain('xdotool')
    const open = deskOpenUrlArgv('staff', home).join(' ')
    expect(open).toContain('xdotool')
    expect(open).toContain('ctrl+l')
    expect(open).toContain('open-url.txt')
    expect(open).toContain('--file')
    expect(open).not.toContain('json/list')
    expect(open).not.toContain('novnc')
    expect(xdoButton(0)).toBe(1)
    expect(xdoButton(2)).toBe(3)
    expect(xdoKey({ key: 'enter' })).toBe('Return')
    expect(xdoKey({ key: 'c', keyChar: 'c', modifiers: { cmd: true, ctrl: false, alt: false, shift: false } })).toBe(
      'ctrl+c',
    )
    rmSync(home, { recursive: true, force: true })
  })

  test('click and capture no-op when the box is down', () => {
    const home = tmpHome()
    const docker = () => ({ status: 0, text: 'false\n' })
    expect(captureDesk('staff', home, { box: { docker } })).toBeNull()
    expect(clickDesk('staff', { x: 1, y: 1 }, 0, home, { box: { docker } })).toBe(false)
    expect(keyDesk('staff', 'a', home, { box: { docker } })).toBe(false)
    expect(openDeskUrl('staff', 'https://github.com/login', home, { box: { docker } })).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  test('a live click does not boot the screen on the hot path', () => {
    const home = tmpHome()
    const calls: string[][] = []
    const docker = (args: string[]) => {
      calls.push(args)
      if (args[0] === 'inspect') return { status: 0, text: 'true\n' }
      return { status: 0, text: '' }
    }
    expect(clickDesk('staff', { x: 8, y: 12 }, 0, home, { box: { docker } })).toBe(true)
    const joined = calls.map((row) => row.join(' '))
    expect(joined.some((row) => row.includes('xdotool') && row.includes('mousemove --sync'))).toBe(true)
    expect(joined.some((row) => row.includes('automaton-screen'))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})
