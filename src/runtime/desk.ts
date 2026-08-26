import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeDeskUrl } from '../domain'
import { boxExec, boxExecAsync, boxSpawn, boxStatus, type BoxSeams } from './box'
import { BOX_DISPLAY_H, BOX_DISPLAY_W, BOX_NAME, mouthScreen } from './computer'
import { desktopDir, ensureDesktop, screenPath } from './desktop'
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

const SAFE_AGENT = /^[A-Za-z0-9_-]+$/
let paintStamp = 0

function activateThen(command: string): string {
  return `xdotool search --onlyvisible --class chromium windowactivate >/dev/null 2>&1; ${command}`
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
    'sh',
    '-c',
    activateThen(
      `xdotool mousemove --sync ${point.x} ${point.y} click ${xdoButton(button)}`,
    ),
  ]
}

export function deskKeyArgv(agentId: string, key: string, home = automatonHome()): string[] {
  const display = mouthScreen(agentId, home).display
  return [
    'exec',
    '-e',
    `DISPLAY=:${display}`,
    BOX_NAME,
    'sh',
    '-c',
    activateThen('xdotool key --clearmodifiers "$1"'),
    'desk-key',
    key,
  ]
}

export function deskUrlTicketBoxPath(agentId: string): string {
  return `/home/box/desktops/${agentId}/open-url.txt`
}

export function deskOpenUrlScript(agentId: string): string {
  const ticket = deskUrlTicketBoxPath(agentId)
  return [
    'best=; bw=0',
    'for id in $(xdotool search --onlyvisible --class chromium 2>/dev/null); do',
    '  eval $(xdotool getwindowgeometry --shell "$id")',
    '  if [ "${WIDTH:-0}" -gt "$bw" ]; then best=$id; bw=$WIDTH; fi',
    'done',
    'if [ -z "$best" ]; then exit 1; fi',
    'xdotool windowactivate --sync "$best"',
    'xdotool key --window "$best" --clearmodifiers ctrl+l',
    `xdotool type --window "$best" --delay 1 --file ${ticket}`,
    'xdotool key --window "$best" Return',
  ].join('\n')
}

export function deskOpenUrlArgv(agentId: string, home = automatonHome()): string[] {
  const display = mouthScreen(agentId, home).display
  return ['exec', '-e', `DISPLAY=:${display}`, BOX_NAME, 'sh', '-c', deskOpenUrlScript(agentId)]
}

function paintPath(agentId: string, home: string, src: string): string | null {
  paintStamp += 1
  const paint = join(desktopDir(agentId, home), `paint-${paintStamp % 2}.png`)
  try {
    copyFileSync(src, paint)
    return paint
  } catch {
    return src
  }
}

function captureScript(agentId: string): string {
  const dest = `/home/box/desktops/${agentId}/screen.png`
  return `xwd -root -silent | xwdtopnm | pnmtopng > ${dest}`
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
  const result = boxExec(['sh', '-c', captureScript(agentId)], { DISPLAY: `:${display}` }, seams.box)
  const path = screenPath(agentId, home)
  if (result.status !== 0 || !existsSync(path)) return null
  return paintPath(agentId, home, path)
}

/** Same capture as captureDesk, but the UI thread never waits on docker. */
export function captureDeskAsync(
  agentId: string,
  done: (path: string | null) => void,
  home = automatonHome(),
  seams: DeskSeams = {},
): void {
  ensureDesktop(agentId, home)
  const display = mouthScreen(agentId, home).display
  boxExecAsync(
    ['sh', '-c', captureScript(agentId)],
    { DISPLAY: `:${display}` },
    (result) => {
      const path = screenPath(agentId, home)
      if (result.status !== 0 || !existsSync(path)) {
        done(null)
        return
      }
      done(paintPath(agentId, home, path))
    },
    seams.box,
  )
}

function injectDesk(
  agentId: string,
  command: string,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!boxStatus(home, seams.box).running) return false
  const env = { DISPLAY: `:${mouthScreen(agentId, home).display}` }
  const argv = ['sh', '-c', activateThen(command)]
  if (seams.box?.docker) return boxExec(argv, env, seams.box).status === 0
  return boxSpawn(argv, env, seams.box)
}

export function clickDesk(
  agentId: string,
  point: Point,
  button = 0,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  return injectDesk(
    agentId,
    `xdotool mousemove --sync ${point.x} ${point.y} click ${xdoButton(button)}`,
    home,
    seams,
  )
}

export function keyDesk(
  agentId: string,
  key: string,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!boxStatus(home, seams.box).running) return false
  const env = { DISPLAY: `:${mouthScreen(agentId, home).display}` }
  const argv = ['sh', '-c', activateThen('xdotool key --clearmodifiers "$1"'), 'desk-key', key]
  if (seams.box?.docker) return boxExec(argv, env, seams.box).status === 0
  return boxSpawn(argv, env, seams.box)
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
  return injectDesk(agentId, `xdotool mousemove --sync ${point.x} ${point.y} click ${button}`, home, seams)
}

export function openDeskUrl(
  agentId: string,
  url: string,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  const safe = sanitizeDeskUrl(url)
  if (!safe || !SAFE_AGENT.test(agentId)) return false
  if (!boxStatus(home, seams.box).running) return false
  if (!ensureScreen(agentId, home, seams.box)) return false
  ensureDesktop(agentId, home)
  writeFileSync(join(desktopDir(agentId, home), 'open-url.txt'), safe)
  const result = boxExec(['sh', '-c', deskOpenUrlScript(agentId)], {
    DISPLAY: `:${mouthScreen(agentId, home).display}`,
  }, seams.box)
  return result.status === 0
}
