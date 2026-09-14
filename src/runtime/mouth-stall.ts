/**
 * Mouth silence watchdog (OpenBot stall-guard / turn-watchdog pattern).
 *
 * Silence ≠ wall-clock duration: long OpenRouter replies stay legal when bytes
 * keep arriving. Wedged mid-response (no chunks for stallMs) fails the mouth
 * with a distinct sentence. Jobs / Puppetmaster are not watched here.
 *
 * Injectable clock so tests can advance time without sleeping. stallMs ≤ 0
 * disables (prior behavior). AUTOMATON_MOUTH_STALL_MS overrides the default.
 */

export type Clock = () => number

export type StalledRead = {
  silentForMs: number
  chunks: number
}

export type MouthStallWatch = {
  noteChunk: () => void
  isStalled: () => boolean
  stalled: () => StalledRead | null
  /** Silence elapsed since open / last chunk. */
  silentForMs: () => number
}

export const MOUTH_STALL_ENV = 'AUTOMATON_MOUTH_STALL_MS'
/** Default silence before a wedged OpenRouter body is abandoned (ms). */
export const DEFAULT_MOUTH_STALL_MS = 45_000

export const MOUTH_STALL_SPEAK =
  'OpenRouter went quiet mid-reply. Try again.'

export function mouthStallMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MOUTH_STALL_ENV]
  if (raw == null || raw.trim() === '') return DEFAULT_MOUTH_STALL_MS
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MOUTH_STALL_MS
  return Math.max(0, Math.floor(n))
}

export function createMouthStallWatch(options: {
  stallMs: number
  now?: Clock
}): MouthStallWatch | null {
  const stallMs = options.stallMs
  if (stallMs <= 0) return null
  const now = options.now ?? Date.now
  let lastChunkAt = now()
  let chunks = 0
  return {
    noteChunk() {
      chunks += 1
      lastChunkAt = now()
    },
    silentForMs() {
      return Math.max(0, now() - lastChunkAt)
    },
    isStalled() {
      return now() - lastChunkAt >= stallMs
    },
    stalled() {
      const silentForMs = now() - lastChunkAt
      if (silentForMs < stallMs) return null
      return { silentForMs, chunks }
    },
  }
}

export class MouthStallError extends Error {
  readonly silentForMs: number
  readonly chunks: number
  constructor(info: StalledRead) {
    super('mouth stalled')
    this.name = 'MouthStallError'
    this.silentForMs = info.silentForMs
    this.chunks = info.chunks
  }
}

export function isMouthStallError(error: unknown): boolean {
  if (error instanceof MouthStallError) return true
  return error instanceof Error && error.message === 'mouth stalled'
}

/**
 * Race a pending read against silence. `tick` advances the poll; tests pass a
 * tick that resolves when they have moved the injectable clock past stallMs.
 */
export async function raceAgainstStall<T>(
  pending: Promise<T>,
  watch: MouthStallWatch,
  options?: {
    /** Called repeatedly until pending settles or stall; default real 10ms poll. */
    tick?: () => Promise<void>
  },
): Promise<T> {
  const tick =
    options?.tick ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  let settled = false
  let rejectStall: ((error: Error) => void) | null = null
  const stallProbe = new Promise<never>((_, reject) => {
    rejectStall = reject
  })
  const loop = (async () => {
    while (!settled) {
      if (watch.isStalled()) {
        const info = watch.stalled() ?? { silentForMs: watch.silentForMs(), chunks: 0 }
        rejectStall?.(new MouthStallError(info))
        return
      }
      await tick()
    }
  })()
  try {
    return await Promise.race([pending, stallProbe])
  } finally {
    settled = true
    await Promise.race([loop, Promise.resolve()]).catch(() => {})
  }
}

/**
 * Read a Response body while watching silence between chunks.
 * Pass-through concatenate for JSON parse — does not hold chunks back from the
 * caller beyond assembling the string chatOpenRouter already needed.
 * stallMs ≤ 0 (or no body) → response.text().
 */
export async function readResponseTextWithStall(
  response: Response,
  options: {
    stallMs: number
    now?: Clock
    tick?: () => Promise<void>
  } = { stallMs: 0 },
): Promise<string> {
  const stallMs = options.stallMs
  const body = response.body
  if (!body || stallMs <= 0) {
    return response.text()
  }
  const watch = createMouthStallWatch({ stallMs, now: options.now })
  if (!watch) return response.text()

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      if (watch.isStalled()) {
        throw new MouthStallError(watch.stalled() ?? { silentForMs: stallMs, chunks: 0 })
      }
      const { done, value } = await raceAgainstStall(reader.read(), watch, { tick: options.tick })
      if (done) break
      if (value) {
        watch.noteChunk()
        text += decoder.decode(value, { stream: true })
      }
    }
    text += decoder.decode()
    return text
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}
