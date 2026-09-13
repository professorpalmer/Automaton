import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { automatonHome } from './keys'
import { agentDir, listProfileIds } from './profile'
import { connectorConfigured } from './connectors'

/** Product routine — schedule XOR event trigger. Not Grok Bot agent crons. */
export type RoutineTriggerType = 'github' | 'slack' | 'webhook'

export type RoutineTrigger = {
  type: RoutineTriggerType
  /** Minimal shape: repo, channel, path, or event name. */
  ref?: string
  event?: string
}

export type Routine = {
  id: string
  agentId: string
  name: string
  /** Saved intent woken into the mouth on fire. */
  prompt: string
  enabled: boolean
  schedule?: string
  trigger?: RoutineTrigger
  createdAt: string
  lastRunAt?: string | null
  lastError?: string | null
  finite?: boolean
  terminalOn?: string
}

export type ResolvedSchedule = {
  kind: 'daily' | 'hourly' | 'cron' | 'named'
  /** Local wall-clock minute 0–59 for hourly; ignored otherwise. */
  minute?: number
  /** Local hour 0–23 for daily/named. */
  hour?: number
  /** 0=Sun … 6=Sat; empty means every day. */
  weekdays?: number[]
  /** Raw cron five-field when kind is cron. */
  cron?: string
  summary: string
}

export type FireSeams = {
  onFire: (input: {
    agentId: string
    prompt: string
    routineId: string
    kickoff: 'routine'
    payload?: unknown
  }) => string | void | Promise<string | void>
  hasConnector?: (id: string) => boolean
  nowIso?: () => string
}

const DEFAULT_TZ = 'America/Chicago'
const STAY_QUIET = /stay quiet|nothing changed|no change/i
const NEED_CONNECTOR: Record<Exclude<RoutineTriggerType, 'webhook'>, string> = {
  github: 'Need GitHub connector.',
  slack: 'Need Slack connector.',
}

let routineSeq = 0

export function resetRoutineIdsForTests(): void {
  routineSeq = 0
}

function nextRoutineId(): string {
  routineSeq += 1
  return `routine_${Date.now().toString(36)}_${routineSeq}`
}

export function automationsDir(agentId: string, home = automatonHome()): string {
  return join(agentDir(agentId, home), 'automations')
}

export function routineDir(agentId: string, id: string, home = automatonHome()): string {
  return join(automationsDir(agentId, home), id)
}

export function routinePath(agentId: string, id: string, home = automatonHome()): string {
  return join(routineDir(agentId, id, home), 'automation.json')
}

function ensureAutomations(agentId: string, home = automatonHome()): string {
  const dir = automationsDir(agentId, home)
  mkdirSync(dir, { recursive: true })
  return dir
}

function asTrigger(raw: unknown): RoutineTrigger | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const type = row.type
  if (type !== 'github' && type !== 'slack' && type !== 'webhook') return undefined
  return {
    type,
    ref: typeof row.ref === 'string' && row.ref.trim() ? row.ref.trim() : undefined,
    event: typeof row.event === 'string' && row.event.trim() ? row.event.trim() : undefined,
  }
}

function normalize(row: Record<string, unknown>, fallbackAgentId: string): Routine | null {
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : ''
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : ''
  const prompt = typeof row.prompt === 'string' ? row.prompt : ''
  if (!id || !name) return null
  const schedule = typeof row.schedule === 'string' && row.schedule.trim() ? row.schedule.trim() : undefined
  const trigger = asTrigger(row.trigger)
  if (schedule && trigger) return null
  if (!schedule && !trigger) return null
  return {
    id,
    agentId:
      typeof row.agentId === 'string' && row.agentId.trim() ? row.agentId.trim() : fallbackAgentId,
    name,
    prompt,
    enabled: row.enabled !== false,
    schedule,
    trigger,
    createdAt:
      typeof row.createdAt === 'string' && row.createdAt ? row.createdAt : new Date().toISOString(),
    lastRunAt:
      typeof row.lastRunAt === 'string' && row.lastRunAt
        ? row.lastRunAt
        : row.lastRunAt === null
          ? null
          : undefined,
    lastError:
      typeof row.lastError === 'string' && row.lastError.trim() ? row.lastError.trim() : null,
    finite: row.finite === true ? true : undefined,
    terminalOn:
      typeof row.terminalOn === 'string' && row.terminalOn.trim()
        ? row.terminalOn.trim()
        : undefined,
  }
}

function readOne(agentId: string, id: string, home: string): Routine | null {
  const path = routinePath(agentId, id, home)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return null
    return normalize(raw as Record<string, unknown>, agentId)
  } catch {
    return null
  }
}

function writeOne(routine: Routine, home: string): void {
  ensureAutomations(routine.agentId, home)
  const dir = routineDir(routine.agentId, routine.id, home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(routinePath(routine.agentId, routine.id, home), `${JSON.stringify(routine, null, 2)}\n`)
}

export function listRoutines(agentId?: string, home = automatonHome()): Routine[] {
  const agents = agentId ? [agentId] : listProfileIds(home)
  const out: Routine[] = []
  for (const id of agents) {
    const root = automationsDir(id, home)
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const row = readOne(id, name, home)
      if (row) out.push(row)
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
}

export type CreateRoutineInput = {
  agentId: string
  name: string
  prompt: string
  schedule?: string
  trigger?: RoutineTrigger
  enabled?: boolean
  finite?: boolean
  terminalOn?: string
  createdAt?: string
}

export function createRoutine(input: CreateRoutineInput, home = automatonHome()): Routine {
  const name = input.name.trim()
  const prompt = input.prompt
  if (!name) throw new Error('routine name required')
  const schedule = input.schedule?.trim() || undefined
  const trigger = input.trigger
  if (schedule && trigger) throw new Error('routine cannot have both schedule and trigger')
  if (!schedule && !trigger) throw new Error('routine needs schedule or trigger')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const routine: Routine = {
    id: nextRoutineId(),
    agentId: input.agentId,
    name,
    prompt,
    enabled: input.enabled !== false,
    schedule,
    trigger,
    createdAt,
    lastRunAt: null,
    lastError: null,
    finite: input.finite === true ? true : undefined,
    terminalOn: input.terminalOn?.trim() || undefined,
  }
  writeOne(routine, home)
  return routine
}

export function updateRoutine(
  agentId: string,
  id: string,
  patch: Partial<
    Pick<
      Routine,
      'name' | 'prompt' | 'enabled' | 'schedule' | 'trigger' | 'lastRunAt' | 'lastError' | 'finite' | 'terminalOn'
    >
  >,
  home = automatonHome(),
): Routine {
  const current = readOne(agentId, id, home)
  if (!current) throw new Error(`unknown routine ${id}`)
  const next: Routine = {
    ...current,
    ...patch,
    id: current.id,
    agentId: current.agentId,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    prompt: patch.prompt !== undefined ? patch.prompt : current.prompt,
    createdAt: current.createdAt,
  }
  if (patch.schedule !== undefined && patch.trigger !== undefined) {
    throw new Error('routine cannot have both schedule and trigger')
  }
  if (patch.schedule !== undefined) {
    next.schedule = patch.schedule.trim() || undefined
    if (next.schedule) next.trigger = undefined
  }
  if (patch.trigger !== undefined) {
    next.trigger = patch.trigger
    if (next.trigger) next.schedule = undefined
  }
  if (next.schedule && next.trigger) throw new Error('routine cannot have both schedule and trigger')
  if (!next.schedule && !next.trigger) throw new Error('routine needs schedule or trigger')
  writeOne(next, home)
  return next
}

export function pauseRoutine(agentId: string, id: string, home = automatonHome()): Routine {
  return updateRoutine(agentId, id, { enabled: false }, home)
}

export function resumeRoutine(agentId: string, id: string, home = automatonHome()): Routine {
  return updateRoutine(agentId, id, { enabled: true, lastError: null }, home)
}

export function deleteRoutine(agentId: string, id: string, home = automatonHome()): void {
  const dir = routineDir(agentId, id, home)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function shouldStayQuiet(prompt: string): boolean {
  return STAY_QUIET.test(prompt)
}

/** Parts in America/Chicago (or tz) for schedule math. */
export function localParts(
  date: Date,
  tz = DEFAULT_TZ,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const bag: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    weekday: weekdayMap[bag.weekday ?? ''] ?? 0,
  }
}

function parseNamedTime(raw: string): { hour: number; minute: number } | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] != null ? Number(m[2]) : 0
  const ap = m[3]?.toLowerCase()
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
  if (ap) {
    if (hour < 1 || hour > 12) return null
    if (ap === 'pm' && hour < 12) hour += 12
    if (ap === 'am' && hour === 12) hour = 0
  } else if (hour > 23) {
    return null
  }
  return { hour, minute }
}

/**
 * Vague `@daily` → weekdays 9:00 local.
 * `@hourly` → wall-clock minute of creation.
 * Named times stay exact. Prefer documenting event triggers over inventing PR/CI polls.
 */
export function resolveSchedule(
  schedule: string,
  createdAt: string,
  tz = DEFAULT_TZ,
): ResolvedSchedule {
  const raw = schedule.trim()
  const lower = raw.toLowerCase()
  const created = new Date(createdAt)
  const createdLocal = localParts(Number.isFinite(created.getTime()) ? created : new Date(), tz)

  if (lower === '@hourly' || lower === 'hourly') {
    return {
      kind: 'hourly',
      minute: createdLocal.minute,
      summary: `hourly at :${String(createdLocal.minute).padStart(2, '0')} ${tz}`,
    }
  }

  if (lower === '@daily' || lower === 'daily' || lower === '@weekday' || lower === 'weekdays') {
    return {
      kind: 'daily',
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5],
      summary: `weekdays 9:00 ${tz}`,
    }
  }

  const weekdayDaily = raw.match(/^(?:weekdays?|mon(?:day)?-fri(?:day)?)\s+(.+)$/i)
  if (weekdayDaily?.[1]) {
    const named = parseNamedTime(weekdayDaily[1])
    if (named) {
      return {
        kind: 'daily',
        hour: named.hour,
        minute: named.minute,
        weekdays: [1, 2, 3, 4, 5],
        summary: `weekdays ${String(named.hour).padStart(2, '0')}:${String(named.minute).padStart(2, '0')} ${tz}`,
      }
    }
  }

  const everyDay = raw.match(/^(?:every\s+day|daily)\s+(.+)$/i)
  if (everyDay?.[1]) {
    const named = parseNamedTime(everyDay[1])
    if (named) {
      return {
        kind: 'named',
        hour: named.hour,
        minute: named.minute,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        summary: `daily ${String(named.hour).padStart(2, '0')}:${String(named.minute).padStart(2, '0')} ${tz}`,
      }
    }
  }

  const bare = parseNamedTime(raw)
  if (bare) {
    return {
      kind: 'named',
      hour: bare.hour,
      minute: bare.minute,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      summary: `${String(bare.hour).padStart(2, '0')}:${String(bare.minute).padStart(2, '0')} ${tz}`,
    }
  }

  const cronParts = raw.split(/\s+/)
  if (cronParts.length === 5) {
    return { kind: 'cron', cron: raw, summary: `${raw} (${tz})` }
  }

  // Fallback: treat unknown tokens like vague daily.
  return {
    kind: 'daily',
    hour: 9,
    minute: 0,
    weekdays: [1, 2, 3, 4, 5],
    summary: `weekdays 9:00 ${tz}`,
  }
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true
  for (const piece of field.split(',')) {
    if (piece.includes('-')) {
      const [a, b] = piece.split('-').map(Number)
      if (Number.isFinite(a) && Number.isFinite(b) && value >= a! && value <= b!) return true
      continue
    }
    if (piece.startsWith('*/')) {
      const step = Number(piece.slice(2))
      if (step > 0 && value % step === 0) return true
      continue
    }
    if (Number(piece) === value) return true
  }
  return false
}

function matchesResolved(resolved: ResolvedSchedule, parts: ReturnType<typeof localParts>): boolean {
  if (resolved.kind === 'hourly') {
    return parts.minute === (resolved.minute ?? 0)
  }
  if (resolved.kind === 'cron' && resolved.cron) {
    const [min, hour, , , dow] = resolved.cron.split(/\s+/)
    if (!min || !hour || !dow) return false
    // cron DOW: 0–6 Sun–Sat (also 7=Sun). Month-day left as *.
    const dowOk =
      cronFieldMatches(dow, parts.weekday) || (dow.includes('7') && parts.weekday === 0 && cronFieldMatches(dow.replace(/7/g, '0'), 0))
    return cronFieldMatches(min, parts.minute) && cronFieldMatches(hour, parts.hour) && dowOk
  }
  const hour = resolved.hour ?? 9
  const minute = resolved.minute ?? 0
  if (parts.hour !== hour || parts.minute !== minute) return false
  const days = resolved.weekdays
  if (days && days.length > 0 && !days.includes(parts.weekday)) return false
  return true
}

function sameLocalMinute(a: Date, b: Date, tz: string): boolean {
  const pa = localParts(a, tz)
  const pb = localParts(b, tz)
  return (
    pa.year === pb.year &&
    pa.month === pb.month &&
    pa.day === pb.day &&
    pa.hour === pb.hour &&
    pa.minute === pb.minute
  )
}

export function isDue(routine: Routine, now: Date, tz = DEFAULT_TZ): boolean {
  if (!routine.enabled || !routine.schedule) return false
  const resolved = resolveSchedule(routine.schedule, routine.createdAt, tz)
  const parts = localParts(now, tz)
  if (!matchesResolved(resolved, parts)) return false
  if (routine.lastRunAt) {
    const last = new Date(routine.lastRunAt)
    if (Number.isFinite(last.getTime()) && sameLocalMinute(last, now, tz)) return false
  }
  return true
}

export function triggerSummary(trigger: RoutineTrigger): string {
  const ref = trigger.ref ? ` ${trigger.ref}` : ''
  const event = trigger.event ? ` · ${trigger.event}` : ''
  return `${trigger.type}${ref}${event}`
}

export function scheduleOrTriggerSummary(routine: Routine, tz = DEFAULT_TZ): string {
  if (routine.schedule) return resolveSchedule(routine.schedule, routine.createdAt, tz).summary
  if (routine.trigger) return triggerSummary(routine.trigger)
  return '—'
}

/** Kickoff sources that appear as first-class routine rows / UI labels. */
export const ROUTINE_KICKOFF_LABELS: Record<'routine' | 'webhook' | 'peer-hop', string> = {
  routine: 'routine',
  webhook: 'webhook',
  'peer-hop': 'peer hop',
}

export function connectorIdForTrigger(trigger: RoutineTrigger): string | null {
  if (trigger.type === 'github' || trigger.type === 'slack') return trigger.type
  return null
}

/**
 * Finite helper: after a fire that marks the terminal event, pause (MVP) so the
 * row remains visible with lastRunAt. Callers may delete instead.
 */
export function applyTerminalOutcome(
  routine: Routine,
  firedEvent?: string,
): { routine: Routine; terminal: boolean; action: 'pause' | 'none' } {
  if (!routine.finite) return { routine, terminal: false, action: 'none' }
  if (routine.terminalOn && firedEvent && firedEvent !== routine.terminalOn) {
    return { routine, terminal: false, action: 'none' }
  }
  if (routine.terminalOn && !firedEvent) {
    return { routine, terminal: false, action: 'none' }
  }
  return {
    routine: { ...routine, enabled: false },
    terminal: true,
    action: 'pause',
  }
}

function connectorMissing(
  routine: Routine,
  hasConnector: (id: string) => boolean,
): string | null {
  if (!routine.trigger) return null
  const id = connectorIdForTrigger(routine.trigger)
  if (!id) return null
  if (hasConnector(id)) return null
  return NEED_CONNECTOR[id as 'github' | 'slack'] ?? `Need ${id} connector.`
}

/**
 * Schedule ticks: fire due enabled routines via seam.
 * Event routines missing connector/auth → pause + Need once (record lastError), no spam.
 */
export async function fireDueRoutines(input: {
  now?: Date
  home?: string
  tz?: string
  seams: FireSeams
  agentId?: string
}): Promise<{ fired: string[]; paused: string[] }> {
  const now = input.now ?? new Date()
  const home = input.home ?? automatonHome()
  const tz = input.tz ?? DEFAULT_TZ
  const hasConnector =
    input.seams.hasConnector ?? ((id: string) => connectorConfigured(id, home))
  const nowIso = input.seams.nowIso ?? (() => now.toISOString())
  const fired: string[] = []
  const paused: string[] = []

  for (const routine of listRoutines(input.agentId, home)) {
    if (routine.trigger) {
      if (!routine.enabled) continue
      const need = connectorMissing(routine, hasConnector)
      if (!need) continue
      // Pause once with Need — do not spam every tick.
      if (routine.lastError === need) continue
      updateRoutine(
        routine.agentId,
        routine.id,
        { enabled: false, lastError: need },
        home,
      )
      paused.push(routine.id)
      continue
    }

    if (!isDue(routine, now, tz)) continue
    const stamped = nowIso()
    updateRoutine(routine.agentId, routine.id, { lastRunAt: stamped, lastError: null }, home)
    let spoken: string | void = undefined
    try {
      spoken = await input.seams.onFire({
        agentId: routine.agentId,
        prompt: routine.prompt,
        routineId: routine.id,
        kickoff: 'routine',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'routine fire failed'
      updateRoutine(routine.agentId, routine.id, { lastError: message }, home)
      continue
    }
    const empty = spoken == null || String(spoken).trim() === ''
    if (empty && shouldStayQuiet(routine.prompt)) {
      // No filler — leave lastRunAt, skip Done./"routine triggered".
      fired.push(routine.id)
      continue
    }
    if (routine.finite) {
      const outcome = applyTerminalOutcome(routine, routine.terminalOn)
      if (outcome.terminal && outcome.action === 'pause') {
        updateRoutine(routine.agentId, routine.id, { enabled: false, lastRunAt: stamped }, home)
      }
    }
    fired.push(routine.id)
  }

  return { fired, paused }
}
