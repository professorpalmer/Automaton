import { dlopen, FFIType } from 'bun:ffi'
import { runningTests } from './test-env'

const HID = 1
const KEY_A = 0
const KEY_X = 7
const KEY_C = 8
const KEY_V = 9
const KEY_Q = 12
const KEY_W = 13
const KEY_LCMD = 55
const KEY_RCMD = 54
const KEY_SHIFT = 56
const KEY_RSHIFT = 60
const KEY_OPT = 58
const KEY_ROPT = 61

export type HidHotkeySeams = {
  intervalMs?: number
  frontmost?: () => boolean
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

export type PasteHotkeySeams = HidHotkeySeams & {
  cmdV?: () => boolean
}

export type CopyHotkeySeams = HidHotkeySeams & {
  cmdC?: () => boolean
}

export type SelectAllHotkeySeams = HidHotkeySeams & {
  cmdA?: () => boolean
}

export type CutHotkeySeams = HidHotkeySeams & {
  cmdX?: () => boolean
}

export type QuitHotkeySeams = HidHotkeySeams & {
  cmdQuit?: () => boolean
}

type KeyState = (state: number, key: number) => boolean

let hidState: KeyState | null | undefined

function loadHid(): KeyState | null {
  if (hidState !== undefined) return hidState
  if (process.platform !== 'darwin') {
    hidState = null
    return null
  }
  try {
    const lib = dlopen('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics', {
      CGEventSourceKeyState: {
        args: [FFIType.i32, FFIType.u16],
        returns: FFIType.bool,
      },
    })
    hidState = (state, key) => Boolean(lib.symbols.CGEventSourceKeyState(state, key))
  } catch {
    hidState = null
  }
  return hidState
}

function cmdHeld(read: KeyState): boolean {
  return Boolean(read(HID, KEY_LCMD) || read(HID, KEY_RCMD))
}

export function cmdVDown(read = loadHid()): boolean {
  if (!read) return false
  return Boolean(read(HID, KEY_V) && cmdHeld(read))
}

function cmdLetterDown(key: number, read = loadHid()): boolean {
  if (!read) return false
  if (!cmdHeld(read)) return false
  if (read(HID, KEY_SHIFT) || read(HID, KEY_RSHIFT)) return false
  if (read(HID, KEY_OPT) || read(HID, KEY_ROPT)) return false
  return Boolean(read(HID, key))
}

export function cmdCDown(read = loadHid()): boolean {
  return cmdLetterDown(KEY_C, read)
}

export function cmdADown(read = loadHid()): boolean {
  return cmdLetterDown(KEY_A, read)
}

export function cmdXDown(read = loadHid()): boolean {
  return cmdLetterDown(KEY_X, read)
}

/** Cmd+Q / Cmd+W. Shift or Option means not quit. */
export function cmdQuitDown(read = loadHid()): boolean {
  if (!read) return false
  if (!cmdHeld(read)) return false
  if (read(HID, KEY_SHIFT) || read(HID, KEY_RSHIFT)) return false
  if (read(HID, KEY_OPT) || read(HID, KEY_ROPT)) return false
  return Boolean(read(HID, KEY_Q) || read(HID, KEY_W))
}

function runOsascript(script: string): string {
  const result = Bun.spawnSync(['osascript', '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return result.exitCode === 0 ? result.stdout.toString().trim() : ''
}

export function isFrontmost(pid = process.pid, query = runOsascript): boolean {
  const raw = query('tell application "System Events" to unix id of first process whose frontmost is true')
  const front = Number(raw)
  return Number.isInteger(front) && front === pid
}

function watchChord(isDown: () => boolean, onFire: () => void, seams?: HidHotkeySeams): () => void {
  if (runningTests() && !seams) return () => {}
  const frontmost = seams?.frontmost ?? isFrontmost
  const start = seams?.setInterval ?? setInterval
  const stop = seams?.clearInterval ?? clearInterval
  let armed = false
  const timer = start(() => {
    const down = isDown()
    if (!down) {
      armed = false
      return
    }
    if (armed) return
    armed = true
    if (!frontmost()) return
    onFire()
  }, seams?.intervalMs ?? 50)
  return () => stop(timer)
}

/** Cmd+V while this process is frontmost. GPUI textarea swallows the React key. */
export function watchPasteHotkey(onPaste: () => void, seams?: PasteHotkeySeams): () => void {
  return watchChord(seams?.cmdV ?? cmdVDown, onPaste, seams)
}

/** Cmd+C. Same swallow as paste. */
export function watchCopyHotkey(onCopy: () => void, seams?: CopyHotkeySeams): () => void {
  return watchChord(seams?.cmdC ?? cmdCDown, onCopy, seams)
}

/** Cmd+A. Same swallow as paste. */
export function watchSelectAllHotkey(onSelectAll: () => void, seams?: SelectAllHotkeySeams): () => void {
  return watchChord(seams?.cmdA ?? cmdADown, onSelectAll, seams)
}

/** Cmd+X. Same swallow as paste. */
export function watchCutHotkey(onCut: () => void, seams?: CutHotkeySeams): () => void {
  return watchChord(seams?.cmdX ?? cmdXDown, onCut, seams)
}

/** Cmd+Q / Cmd+W. Same swallow as paste; desk focus also ate the React chord. */
export function watchQuitHotkey(onQuit: () => void, seams?: QuitHotkeySeams): () => void {
  return watchChord(seams?.cmdQuit ?? cmdQuitDown, onQuit, seams)
}
