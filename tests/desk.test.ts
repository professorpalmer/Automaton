import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { boxMounts } from '../src/runtime/box'
import { BOX_DISPLAY_H, BOX_DISPLAY_W, BOX_NAME } from '../src/runtime/computer'
import {
  captureDesk,
  clickDesk,
  deskCaptureArgv,
  deskClickArgv,
  deskKeyArgv,
  deskOpenUrlArgv,
  deskStroke,
  deskStrokeArgv,
  keyDesk,
  mapViewToDisplay,
  openDeskUrl,
  resolveDeskHit,
  xdoButton,
  xdoKey,
} from '../src/runtime/desk'
import { screenPath } from '../src/runtime/desktop'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-desk-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

function runningBox(home: string) {
  return (args: string[]) => {
    if (args[0] === 'inspect' && args.includes('{{.Image}}')) return { status: 0, text: 'sha256:abc\n' }
    if (args[0] === 'inspect' && args.some((arg) => arg.includes('PortBindings'))) {
      return { status: 0, text: '{"9221/tcp":[{"HostIp":"127.0.0.1","HostPort":"9221"}]}\n' }
    }
    if (args[0] === 'inspect' && args.some((arg) => arg.includes('Mounts'))) {
      return { status: 0, text: `/home/box/desktops=${boxMounts(home).desktops}\n` }
    }
    if (args[0] === 'inspect') return { status: 0, text: 'true\n' }
    if (args[0] === 'image') return { status: 0, text: 'sha256:abc\n' }
    if (args[0] === 'exec') return { status: 0, text: '/usr/local/bin/automaton-screen\n' }
    return { status: 1, text: 'unknown' }
  }
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
    const shifted = { x: 400, y: 200, width: 252, height: 158 }
    expect(mapViewToDisplay(shifted, { x: 126, y: 79 })).toBeNull()
    expect(resolveDeskHit(shifted, { x: 126, y: 79 })).toEqual(
      mapViewToDisplay({ ...shifted, x: 0, y: 0 }, { x: 126, y: 79 }),
    )
    expect(resolveDeskHit(view, { x: 10 + 126, y: 20 + 79 })).toEqual(inside)
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
    expect(click).toContain('windowactivate')
    expect(click).not.toContain('windowactivate --sync')
    expect(click).toContain('|| true')
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
    expect(deskStroke({ key: '.', keyChar: '.' })).toEqual({ via: 'type', value: '.' })
    expect(deskStroke({ key: 'period' })).toEqual({ via: 'type', value: '.' })
    expect(deskStroke({ key: 'g', keyChar: 'g' })).toEqual({ via: 'type', value: 'g' })
    expect(deskStroke({ key: 'enter' })).toEqual({ via: 'key', value: 'Return' })
    expect(deskStroke({ key: 'c', keyChar: 'c', modifiers: { cmd: true, ctrl: false, alt: false, shift: false } })).toEqual(
      { via: 'key', value: 'ctrl+c' },
    )
    expect(deskStrokeArgv('staff', { via: 'type', value: '.' }, home).join(' ')).toContain('xdotool type')
    expect(deskStrokeArgv('staff', { via: 'type', value: '.' }, home).join(' ')).toContain('--clearmodifiers --')
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

  test('three captures keep the newest two paint files and drop the third-oldest', () => {
    const home = tmpHome()
    const screen = screenPath('staff', home)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    writeFileSync(screen, 'frame')
    const docker = runningBox(home)
    const first = captureDesk('staff', home, { box: { docker } })
    const second = captureDesk('staff', home, { box: { docker } })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(screen)
    expect(second).not.toBe(screen)
    expect(second).not.toBe(first)
    expect(first).toContain(`paint-${process.pid}-`)
    expect(second).toContain(`paint-${process.pid}-`)
    expect(existsSync(first!)).toBe(true)
    expect(existsSync(second!)).toBe(true)
    const third = captureDesk('staff', home, { box: { docker } })
    expect(third).not.toBeNull()
    expect(third).not.toBe(screen)
    expect(third).not.toBe(first)
    expect(third).not.toBe(second)
    expect(third).toContain(`paint-${process.pid}-`)
    expect(existsSync(first!)).toBe(false)
    expect(existsSync(second!)).toBe(true)
    expect(existsSync(third!)).toBe(true)
    expect(existsSync(screen)).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
