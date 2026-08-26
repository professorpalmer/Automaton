import { existsSync } from 'node:fs'
import { boxExec, boxStatus, type BoxSeams } from './box'
import { BOX_DISPLAY_H, BOX_DISPLAY_W, BOX_NAME, mouthScreen } from './computer'
import { ensureDesktop, screenPath } from './desktop'
import { automatonHome } from './keys'
import { ensureScreen } from './screen'

export type DeskSeams = {
  box?: BoxSeams
}

export type ViewBox = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }

const KEYS: Record<string, string> = {
  enter: 'Return',
  return: 'Return',
  backspace: 'BackSpace',
  delete: 'Delete',
  escape: 'Escape',
  tab: 'Tab',
  space: 'space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
}

/** Map a window click on an object-fit:contain view onto the X display. Letterbox misses are null. */
export function mapViewToDisplay(
  view: ViewBox,
  click: Point,
  display = { width: BOX_DISPLAY_W, height: BOX_DISPLAY_H },
): Point | null {
  if (view.width <= 0 || view.height <= 0) return null
  const ratio = display.width / display.height
  const viewRatio = view.width / view.height
  let contentW = view.width
  let contentH = view.height
  let padX = 0
  let padY = 0
  if (viewRatio > ratio) {
    contentW = view.height * ratio
    padX = (view.width - contentW) / 2
  } else if (viewRatio < ratio) {
    contentH = view.width / ratio
    padY = (view.height - contentH) / 2
  }
  const localX = click.x - view.x - padX
  const localY = click.y - view.y - padY
  if (localX < 0 || localY < 0 || localX > contentW || localY > contentH) return null
  const x = Math.round((localX / contentW) * (display.width - 1))
  const y = Math.round((localY / contentH) * (display.height - 1))
  return {
    x: Math.min(display.width - 1, Math.max(0, x)),
    y: Math.min(display.height - 1, Math.max(0, y)),
  }
}

export function xdoButton(button?: number): number {
  if (button === 2) return 3
  if (button === 1) return 2
  return 1
}

export function xdoKey(event: {
  key?: string
  keyChar?: string
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
}): string | null {
  const raw = event.key?.toLowerCase() ?? ''
  const named = KEYS[raw]
  const base = named ?? (event.keyChar && event.keyChar.length === 1 ? event.keyChar : raw)
  if (!base) return null
  const parts: string[] = []
  if (event.modifiers?.cmd || event.modifiers?.ctrl) parts.push('ctrl')
  if (event.modifiers?.alt) parts.push('alt')
  if (event.modifiers?.shift && base.length > 1) parts.push('shift')
  parts.push(base)
  return parts.join('+')
}

export function deskCaptureArgv(agentId: string, home = automatonHome()): string[] {
  const display = mouthScreen(agentId, home).display
  const dest = `/home/box/desktops/${agentId}/screen.png`
  return [
    'exec',
    '-e',
    `DISPLAY=:${display}`,
    BOX_NAME,
    'sh',
    '-c',
    `xwd -root -silent | xwdtopnm | pnmtopng > ${dest}`,
  ]
}

export function deskClickArgv(
  agentId: string,
  point: Point,
  button = 0,
  home = automatonHome(),
): string[] {
  const display = mouthScreen(agentId, home).display
  return [
    'exec',
    '-e',
    `DISPLAY=:${display}`,
    BOX_NAME,
    'xdotool',
    'mousemove',
    String(point.x),
    String(point.y),
    'click',
    String(xdoButton(button)),
  ]
}

export function deskKeyArgv(agentId: string, key: string, home = automatonHome()): string[] {
  const display = mouthScreen(agentId, home).display
  return ['exec', '-e', `DISPLAY=:${display}`, BOX_NAME, 'xdotool', 'key', '--clearmodifiers', key]
}

export function captureDesk(
  agentId: string,
  home = automatonHome(),
  seams: DeskSeams = {},
): string | null {
  if (!boxStatus(home, seams.box).running) return null
  if (!ensureScreen(agentId, home, seams.box)) return null
  ensureDesktop(agentId, home)
  const display = mouthScreen(agentId, home).display
  const dest = `/home/box/desktops/${agentId}/screen.png`
  const result = boxExec(
    ['sh', '-c', `xwd -root -silent | xwdtopnm | pnmtopng > ${dest}`],
    { DISPLAY: `:${display}` },
    seams.box,
  )
  const path = screenPath(agentId, home)
  if (result.status !== 0 || !existsSync(path)) return null
  return path
}

export function clickDesk(
  agentId: string,
  point: Point,
  button = 0,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!boxStatus(home, seams.box).running) return false
  if (!ensureScreen(agentId, home, seams.box)) return false
  const result = boxExec(
    ['xdotool', 'mousemove', String(point.x), String(point.y), 'click', String(xdoButton(button))],
    { DISPLAY: `:${mouthScreen(agentId, home).display}` },
    seams.box,
  )
  return result.status === 0
}

export function keyDesk(
  agentId: string,
  key: string,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!boxStatus(home, seams.box).running) return false
  if (!ensureScreen(agentId, home, seams.box)) return false
  const result = boxExec(
    ['xdotool', 'key', '--clearmodifiers', key],
    { DISPLAY: `:${mouthScreen(agentId, home).display}` },
    seams.box,
  )
  return result.status === 0
}

export function wheelDesk(
  agentId: string,
  point: Point,
  deltaY: number,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!deltaY) return false
  const button = deltaY < 0 ? 4 : 5
  if (!boxStatus(home, seams.box).running) return false
  const result = boxExec(
    ['xdotool', 'mousemove', String(point.x), String(point.y), 'click', String(button)],
    { DISPLAY: `:${mouthScreen(agentId, home).display}` },
    seams.box,
  )
  return result.status === 0
}
