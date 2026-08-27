/** One writer per display. Renewable. Dead turns expire. Fail open. */

export const LEASE_TTL_MS = 30_000
export const IDLE_SUSPEND_WINDOW_MS = 30_000

export type LeaseHold = {
  display: number
  holderId: string
  expiresAt: number
  lastEventAt: number
}

export type LeaseAcquire =
  | { ok: true; lease: LeaseHold }
  | { ok: false; reason: 'busy'; holderId: string; retryAt: number }

export type IdleSuspend = { ok: true } | { ok: false; reason: 'busy'; retryAt: number }

type Clock = () => number

function safeNow(clock: Clock): number | null {
  try {
    const n = clock()
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    return n
  } catch {
    return null
  }
}

export function createDisplayLeases(clock: Clock = () => Date.now()) {
  const holds = new Map<number, LeaseHold>()

  function current(display: number, now: number): LeaseHold | null {
    const row = holds.get(display)
    if (!row) return null
    if (row.expiresAt <= now) {
      holds.delete(display)
      return null
    }
    return row
  }

  return {
    acquire(display: number, holderId: string): LeaseAcquire {
      const now = safeNow(clock)
      if (now == null) {
        return { ok: true, lease: { display, holderId, expiresAt: 0, lastEventAt: 0 } }
      }
      const held = current(display, now)
      if (held && held.holderId !== holderId) {
        return { ok: false, reason: 'busy', holderId: held.holderId, retryAt: held.expiresAt }
      }
      const lease: LeaseHold = {
        display,
        holderId,
        expiresAt: now + LEASE_TTL_MS,
        lastEventAt: now,
      }
      holds.set(display, lease)
      return { ok: true, lease }
    },

    renew(display: number, holderId: string): boolean {
      const now = safeNow(clock)
      if (now == null) return true
      const held = current(display, now)
      if (!held || held.holderId !== holderId) return false
      held.expiresAt = now + LEASE_TTL_MS
      held.lastEventAt = now
      holds.set(display, held)
      return true
    },

    release(display: number, holderId: string): boolean {
      const now = safeNow(clock)
      if (now == null) {
        holds.delete(display)
        return true
      }
      const held = holds.get(display)
      if (!held) return true
      if (held.holderId !== holderId) return false
      holds.delete(display)
      return true
    },

    holder(display: number): string | null {
      const now = safeNow(clock)
      if (now == null) return null
      return current(display, now)?.holderId ?? null
    },

    busy(display: number): boolean {
      const now = safeNow(clock)
      if (now == null) return false
      return current(display, now) != null
    },

    /** Disk the computer only when no display is leased. Defer if busy; retry a full window. */
    idleSuspend(): IdleSuspend {
      const now = safeNow(clock)
      if (now == null) return { ok: true }
      let retryAt = now + IDLE_SUSPEND_WINDOW_MS
      let busy = false
      for (const display of [...holds.keys()]) {
        const held = current(display, now)
        if (!held) continue
        busy = true
        retryAt = Math.max(retryAt, now + IDLE_SUSPEND_WINDOW_MS)
      }
      if (busy) return { ok: false, reason: 'busy', retryAt }
      return { ok: true }
    },

    resetForTests(): void {
      holds.clear()
    },
  }
}

export type DisplayLeases = ReturnType<typeof createDisplayLeases>

let shared: DisplayLeases | null = null

export function displayLeases(): DisplayLeases {
  if (!shared) shared = createDisplayLeases()
  return shared
}

export function resetDisplayLeasesForTests(): void {
  shared = createDisplayLeases()
}
