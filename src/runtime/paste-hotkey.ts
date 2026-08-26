import { dlopen, FFIType } from 'bun:ffi'
import { runningTests } from './test-env'

const HID = 1
const KEY_V = 9
const KEY_LCMD = 55
const KEY_RCMD = 54

export type PasteHotkeySeams = {
  intervalMs?: number
  cmdV?: () => boolean
  frontmost?: () => boolean
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
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

export function cmdVDown(read = loadHid()): boolean {
  if (!read) return false
  const v = read(HID, KEY_V)
  const cmd = read(HID, KEY_LCMD) || read(HID, KEY_RCMD)
  return Boolean(v && cmd)
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

/** Cmd+V while this process is frontmost. GPUI textarea swallows the React key. */
export function watchPasteHotkey(onPaste: () => void, seams?: PasteHotkeySeams): () => void {
  if (runningTests() && !seams) return () => {}
  const cmdV = seams?.cmdV ?? cmdVDown
  const frontmost = seams?.frontmost ?? isFrontmost
  const start = seams?.setInterval ?? setInterval
  const stop = seams?.clearInterval ?? clearInterval
  let armed = false
  const timer = start(() => {
    const down = cmdV()
    if (!down) {
      armed = false
      return
    }
    if (armed) return
    armed = true
    if (!frontmost()) return
    onPaste()
  }, seams?.intervalMs ?? 50)
  return () => stop(timer)
}
