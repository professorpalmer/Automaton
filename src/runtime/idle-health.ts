import { spawnSync } from 'node:child_process'
import { STREAM_COMMIT_MS } from './feed-pin'

/** Soft ceiling: sustained %CPU at/above this with feed at rest → doctor WARN. */
export const IDLE_CPU_WARN_PCT = 40

/** Documented paced GPUIX frame loop baseline (one core), not a hard gate. */
export const IDLE_CPU_PACED_BASELINE_PCT = 1.5

/** Settled spring hard budget (ms) — mirrors gpuix motion-spring SETTLE_HARD_MS. */
export const IDLE_SPRING_SETTLE_HARD_MS = 420

/** GPUIX startFrameLoop / motion-spring frame cadence (ms). */
export const IDLE_FRAME_MS = 8

export type IdlePark = {
  id: string
  path: string
  summary: string
}

/** Inventory of idle parks already shipped. Keep in sync with docs/idle-cpu.md. */
export function idleParkInventory(): IdlePark[] {
  return [
    {
      id: 'spring-lease',
      path: 'src/blob.tsx SpringBox + vendor @gpuix/react MotionDiv → native motion.rs',
      summary: `native spring (GELATIN / EYE_SPRING) via host motion prop; 420ms hard park so GPUI sleeps (settle ≤${IDLE_SPRING_SETTLE_HARD_MS}ms); JS motion-spring lease remains for leftover useRestingStyle`,
    },
    {
      id: 'sister-freeze',
      path: 'src/blob.tsx + src/app.tsx (alive = selected || working)',
      summary:
        'Idle sisters drop wander/blink/melt clocks; selected Staff may glance + soft restMelt; springs immediate when !alive',
    },
    {
      id: 'stream-commit',
      path: 'src/runtime/feed-pin.ts',
      summary: `${STREAM_COMMIT_MS}ms STREAM_COMMIT coalesce + FEED_TAIL pin so grow ticks do not scroll every char`,
    },
    {
      id: 'row-fingerprint',
      path: 'src/runtime/feed-row.ts',
      summary: 'Row fingerprints avoid wholesale feed rebuilds on last-line growth',
    },
    {
      id: 'frame-pace',
      path: 'vendored @gpuix/react startFrameLoop',
      summary: `${IDLE_FRAME_MS}ms paced AppKit pump (not setImmediate); GPUI parks when nothing is dirty`,
    },
    {
      id: 'activity-takeover',
      path: 'src/chrome/activity.ts + src/chrome/activity-zone.tsx',
      summary:
        'Thinking/tool disclosure paints only while streaming or user-held; no MotionDiv / no interval ticks',
    },
  ]
}

export type IdleCpuSample = {
  pid: number
  meanPct: number
  samples: number[]
  etime?: string
  cputime?: string
}

export type IdleCpuDoctor = {
  status: 'ok' | 'warn' | 'skip'
  note: string
  sample?: IdleCpuSample
  parks: IdlePark[]
}

export function parsePsCpuLines(text: string): number[] {
  const out: number[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const n = Number.parseFloat(trimmed)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

export function meanCpu(samples: number[]): number {
  if (samples.length === 0) return 0
  return samples.reduce((a, b) => a + b, 0) / samples.length
}

/** True when sustained idle CPU looks like thrash (multi-core / hot single-core). */
export function idleCpuLooksHot(meanPct: number, warnPct = IDLE_CPU_WARN_PCT): boolean {
  return meanPct >= warnPct
}

export function findAutomatonPids(listPs?: () => string): number[] {
  const text =
    listPs?.() ??
    spawnSync('pgrep', ['-f', 'Automaton.*/src/main\\.tsx|Automaton.app/Contents/MacOS'], {
      encoding: 'utf8',
    }).stdout ??
    ''
  return text
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function psField(pid: number, format: string): string {
  const result = spawnSync('ps', ['-p', String(pid), `-o${format}=`], { encoding: 'utf8' })
  return (result.stdout ?? '').trim()
}

export function sampleAutomatonCpu(opts?: {
  pid?: number
  samples?: number
  intervalMs?: number
  listPs?: () => string
  readCpu?: (pid: number) => number | null
  sleep?: (ms: number) => void
}): IdleCpuSample | null {
  const pid = opts?.pid ?? findAutomatonPids(opts?.listPs)[0]
  if (!pid) return null
  const count = Math.max(1, opts?.samples ?? 5)
  const intervalMs = opts?.intervalMs ?? 1000
  const sleep =
    opts?.sleep ??
    ((ms: number) => {
      if (ms > 0) spawnSync('sleep', [String(ms / 1000)])
    })
  const readCpu =
    opts?.readCpu ??
    ((id: number) => {
      const raw = psField(id, '%cpu')
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) ? n : null
    })
  const samples: number[] = []
  for (let i = 0; i < count; i += 1) {
    const n = readCpu(pid)
    if (n != null) samples.push(n)
    if (i + 1 < count) sleep(intervalMs)
  }
  if (samples.length === 0) return null
  return {
    pid,
    meanPct: meanCpu(samples),
    samples,
    etime: psField(pid, 'etime') || undefined,
    cputime: psField(pid, 'time') || undefined,
  }
}

/**
 * Doctor idle-health. Never flips DoctorReport.ok alone.
 * Default: skip live sample (CI / fast doctor) and point at docs.
 * Set AUTOMATON_IDLE_CPU=1 to sample a live process and WARN if hot.
 */
export function doctorIdleCpu(opts?: {
  forceSkip?: boolean
  sampleLive?: boolean
  listPs?: () => string
  sample?: () => IdleCpuSample | null
  warnPct?: number
}): IdleCpuDoctor {
  const parks = idleParkInventory()
  const sampleLive =
    opts?.sampleLive === true ||
    (opts?.sampleLive !== false &&
      opts?.forceSkip !== true &&
      process.env.AUTOMATON_IDLE_CPU === '1' &&
      process.env.CI !== 'true' &&
      process.env.AUTOMATON_SKIP_IDLE_CPU !== '1')

  if (opts?.forceSkip === true || !sampleLive) {
    return {
      status: 'skip',
      note: 'idle CPU checklist: docs/idle-cpu.md (live sample: AUTOMATON_IDLE_CPU=1 bun run doctor)',
      parks,
    }
  }

  const sample = opts?.sample?.() ?? sampleAutomatonCpu({ listPs: opts?.listPs, samples: 5, intervalMs: 1000 })
  if (!sample) {
    return {
      status: 'skip',
      note: 'no live Automaton process — open with `bun run app`, then sample (docs/idle-cpu.md)',
      parks,
    }
  }
  const warnPct = opts?.warnPct ?? IDLE_CPU_WARN_PCT
  const rounded = Math.round(sample.meanPct * 10) / 10
  if (idleCpuLooksHot(sample.meanPct, warnPct)) {
    return {
      status: 'warn',
      note: `idle Automaton pid ${sample.pid} mean ${rounded}% CPU (≥${warnPct}% thrash gate) — check parks in docs/idle-cpu.md`,
      sample,
      parks,
    }
  }
  return {
    status: 'ok',
    note: `idle Automaton pid ${sample.pid} mean ${rounded}% CPU (paced baseline ~${IDLE_CPU_PACED_BASELINE_PCT}%; thrash gate ${warnPct}%)`,
    sample,
    parks,
  }
}
