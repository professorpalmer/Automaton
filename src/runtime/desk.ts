import { copyFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
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
const paintPid = process.pid
let paintSeq = 0
const paintsByDesk = new Map<string, string[]>()

function activateThen(command: string): string {
  return `ids=$(xdotool search --onlyvisible --class chromium 2>/dev/null || true); [ -n "$ids" ] && xdotool windowactivate $ids >/dev/null 2>&1; ${command}`
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

/** GPUI events are window pixels. A missed origin still maps if the click was local to the view. */
export function resolveDeskHit(view: ViewBox, click: Point): Point | null {
  return mapViewToDisplay(view, click) ?? mapViewToDisplay({ ...view, x: 0, y: 0 }, click)
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
  const stroke = deskStroke(event)
  if (!stroke) return null
  if (stroke.via === 'type') return punctKeysym(stroke.value) ?? stroke.value
  return stroke.value
}

export type DeskStroke = { via: 'key'; value: string } | { via: 'type'; value: string }

const PUNCT: Record<string, string> = {
  '.': 'period',
  ',': 'comma',
  '/': 'slash',
  '-': 'minus',
  '=': 'equal',
  ';': 'semicolon',
  "'": 'apostrophe',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\\': 'backslash',
  '`': 'grave',
  ' ': 'space',
}

function punctKeysym(ch: string): string | null {
  return PUNCT[ch] ?? null
}

function printableChar(event: {
  key?: string
  keyChar?: string
}): string | null {
  if (event.keyChar && event.keyChar.length === 1 && event.keyChar >= ' ') return event.keyChar
  if (event.key && event.key.length === 1 && event.key >= ' ') return event.key
  const raw = event.key?.toLowerCase() ?? ''
  if (raw === 'period') return '.'
  if (raw === 'comma') return ','
  if (raw === 'slash') return '/'
  if (raw === 'minus' || raw === 'hyphen') return '-'
  if (raw === 'equal') return '='
  if (raw === 'space') return ' '
  return null
}

/** Named keys use xdotool key. Printable glyphs use type; `.` is not an X keysym. */
export function deskStroke(event: {
  key?: string
  keyChar?: string
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
}): DeskStroke | null {
  const chord = Boolean(event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt)
  const named = KEYS[event.key?.toLowerCase() ?? '']
  if (chord) {
    const raw = event.key?.toLowerCase() ?? ''
    const base = named ?? (event.keyChar && event.keyChar.length === 1 ? event.keyChar : raw)
    if (!base) return null
    const parts: string[] = []
    if (event.modifiers?.cmd || event.modifiers?.ctrl) parts.push('ctrl')
    if (event.modifiers?.alt) parts.push('alt')
    if (event.modifiers?.shift && base.length > 1) parts.push('shift')
    parts.push(punctKeysym(base) ?? base)
    return { via: 'key', value: parts.join('+') }
  }
  if (named) return { via: 'key', value: named }
  const ch = printableChar(event)
  if (ch) return { via: 'type', value: ch }
  return null
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
  return deskStrokeArgv(agentId, { via: 'key', value: key }, home)
}

export function deskStrokeArgv(
  agentId: string,
  stroke: DeskStroke,
  home = automatonHome(),
): string[] {
  const display = mouthScreen(agentId, home).display
  const inner =
    stroke.via === 'type' ? 'xdotool type --clearmodifiers -- "$1"' : 'xdotool key --clearmodifiers "$1"'
  return [
    'exec',
    '-e',
    `DISPLAY=:${display}`,
    BOX_NAME,
    'sh',
    '-c',
    activateThen(inner),
    'desk-stroke',
    stroke.value,
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

/** GPUI caches decoded images by src path; a reused paint file stays visually stale. */
function paintPath(agentId: string, home: string, src: string): string {
  paintSeq += 1
  const desk = desktopDir(agentId, home)
  const paint = join(desk, `paint-${paintPid}-${paintSeq}.png`)
  try {
    copyFileSync(src, paint)
  } catch {
    return src
  }
  const kept = paintsByDesk.get(desk) ?? []
  kept.push(paint)
  const stale = kept.length > 2 ? kept.shift() : undefined
  paintsByDesk.set(desk, kept)
  if (stale && stale !== paint) {
    try {
      unlinkSync(stale)
    } catch {
      /* leftover paint must not fail capture */
    }
  }
  return paint
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
  return sendDeskStroke(agentId, { via: 'key', value: key }, home, seams)
}

export function sendDeskStroke(
  agentId: string,
  stroke: DeskStroke,
  home = automatonHome(),
  seams: DeskSeams = {},
): boolean {
  if (!boxStatus(home, seams.box).running) return false
  const env = { DISPLAY: `:${mouthScreen(agentId, home).display}` }
  const inner =
    stroke.via === 'type' ? 'xdotool type --clearmodifiers -- "$1"' : 'xdotool key --clearmodifiers "$1"'
  const argv = ['sh', '-c', activateThen(inner), 'desk-stroke', stroke.value]
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
