/**
 * Mac OS Notification Center banners (Wave 6 P2).
 *
 * Optional: Settings → Window → Background notify. Kill-switch:
 * `AUTOMATON_DISABLE_NOTIFICATIONS`. Failures are swallowed — a missing
 * notifier must never bother the mouth / approval path.
 *
 * Click routing: plain `display notification` cannot hand us a click. We
 * park the sister id and bring Automaton frontmost when the user returns
 * (or immediately after post when we can focus ourselves).
 */
import { spawn, spawnSync } from 'node:child_process'
import { isFrontmost } from './paste-hotkey'
import { runningTests } from './test-env'

export const OS_NOTIFY_DISABLE_ENV = 'AUTOMATON_DISABLE_NOTIFICATIONS'

export type OsNotifyInput = {
  title: string
  body: string
  /** Sister to focus when the user returns / we activate. */
  agentId?: string
}

export type OsNotifySeams = {
  enabled?: boolean
  frontmost?: () => boolean
  post?: (title: string, body: string) => void
  focusSelf?: () => boolean
  now?: () => number
}

let pendingFocusAgentId: string | null = null

export function resetOsNotifyForTests(): void {
  pendingFocusAgentId = null
}

export function peekPendingNotifyFocus(): string | null {
  return pendingFocusAgentId
}

export function takePendingNotifyFocus(): string | null {
  const id = pendingFocusAgentId
  pendingFocusAgentId = null
  return id
}

export function parkPendingNotifyFocus(agentId: string | undefined): void {
  if (agentId && agentId.trim()) pendingFocusAgentId = agentId.trim()
}

/** Kill-switch or Quiet (setting off) → no banner. */
export function osNotifyAllowed(enabled: boolean): boolean {
  if (!enabled) return false
  if (process.env[OS_NOTIFY_DISABLE_ENV]) return false
  if (runningTests()) return false
  return true
}

export function shouldPostBackgroundNotify(
  enabled: boolean,
  seams: Pick<OsNotifySeams, 'frontmost'> = {},
): boolean {
  if (!osNotifyAllowed(enabled)) return false
  const frontmost = seams.frontmost ?? (() => isFrontmost())
  try {
    if (frontmost()) return false
  } catch {
    return false
  }
  return true
}

function applescriptEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function defaultPost(title: string, body: string): void {
  if (process.platform !== 'darwin') return
  const script = `display notification "${applescriptEscape(body)}" with title "${applescriptEscape(title)}"`
  try {
    const child = spawn('osascript', ['-e', script], {
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
  } catch {
    // swallow
  }
}

/** Bring this Automaton process forward (same path as host Chrome focus). */
export function focusAutomaton(pid = process.pid): boolean {
  if (runningTests() || process.platform !== 'darwin' || pid <= 1) return false
  try {
    const result = spawnSync(
      'osascript',
      [
        '-e',
        `tell application "System Events" to set frontmost of (first process whose unix id is ${Math.floor(pid)}) to true`,
      ],
      { encoding: 'utf8', timeout: 8000 },
    )
    return result.status === 0
  } catch {
    return false
  }
}

/** Post a banner when allowed. Parks sister focus; never throws. */
export function postOsNotify(input: OsNotifyInput, seams: OsNotifySeams = {}): boolean {
  try {
    const enabled = seams.enabled === true
    if (!shouldPostBackgroundNotify(enabled, seams)) return false
    const title = input.title.trim() || 'Automaton'
    const body = input.body.trim() || 'Done.'
    parkPendingNotifyFocus(input.agentId)
    const post = seams.post ?? defaultPost
    post(title, body)
    return true
  } catch {
    return false
  }
}

/**
 * If a banner parked a sister and we are (or just became) frontmost, return
 * that id once. Caller selects the sister. No timer when nothing is parked.
 */
export function claimNotifyFocusIfFrontmost(seams: Pick<OsNotifySeams, 'frontmost'> = {}): string | null {
  if (!pendingFocusAgentId) return null
  const frontmost = seams.frontmost ?? (() => isFrontmost())
  try {
    if (!frontmost()) return null
  } catch {
    return null
  }
  return takePendingNotifyFocus()
}
