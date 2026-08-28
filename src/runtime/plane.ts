import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { automatonHome } from './keys'
import { runningTests } from './test-env'

/** One OpenRouter model for every mouth and every Puppetmaster job. */
export const DEFAULT_SEAT_MODEL = 'openai/gpt-4o-mini'

export type SeatBinding = {
  model?: string
  effort?: string
  thinking?: boolean
  fast?: boolean
}

export type SeatPlane = {
  model: string
  seats?: Record<string, SeatBinding>
}

export function planePath(home = automatonHome()): string {
  return join(home, 'plane.json')
}

function parseSeatBinding(raw: unknown): SeatBinding {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const binding: SeatBinding = {}
  if (typeof row.model === 'string' && row.model.trim()) binding.model = row.model.trim()
  if (typeof row.effort === 'string' && row.effort.trim()) binding.effort = row.effort.trim()
  if (typeof row.thinking === 'boolean') binding.thinking = row.thinking
  if (typeof row.fast === 'boolean') binding.fast = row.fast
  return binding
}

function parseSeats(raw: unknown): Record<string, SeatBinding> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, SeatBinding> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const agentId = id.trim()
    if (!agentId) continue
    out[agentId] = parseSeatBinding(value)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function parsePlane(raw: unknown): SeatPlane {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  const seats = parseSeats(row.seats)
  const plane: SeatPlane = { model: model || DEFAULT_SEAT_MODEL }
  if (seats) plane.seats = seats
  return plane
}

export function readPlane(home = automatonHome()): SeatPlane {
  const path = planePath(home)
  if (!existsSync(path)) return { model: DEFAULT_SEAT_MODEL }
  try {
    return parsePlane(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { model: DEFAULT_SEAT_MODEL }
  }
}

export function writePlane(plane: SeatPlane, home = automatonHome()): void {
  mkdirSync(home, { recursive: true })
  const model = parsePlane(plane).model
  const seats =
    plane.seats !== undefined ? parseSeats(plane.seats) : parseSeats(readPlane(home).seats)
  const out: Record<string, unknown> = { model }
  if (seats) out.seats = seats
  writeFileSync(planePath(home), `${JSON.stringify(out, null, 2)}\n`)
}

export function seatModel(home = automatonHome()): string {
  const env = process.env.AUTOMATON_MODEL?.trim()
  if (env) return env
  if (runningTests() && !process.env.AUTOMATON_HOME?.trim() && home === join(homedir(), '.automaton')) {
    return DEFAULT_SEAT_MODEL
  }
  return readPlane(home).model
}

export function seatBinding(agentId: string, home = automatonHome()): SeatBinding {
  const id = String(agentId || '').trim()
  if (!id) return {}
  return readPlane(home).seats?.[id] ?? {}
}

export function writeSeatBinding(agentId: string, patch: SeatBinding, home = automatonHome()): void {
  const id = String(agentId || '').trim()
  if (!id) return
  const plane = readPlane(home)
  const next: SeatBinding = { ...seatBinding(id, home) }
  if ('model' in patch) {
    const model = patch.model?.trim()
    if (model) next.model = model
    else delete next.model
  }
  if ('effort' in patch) {
    const effort = patch.effort?.trim()
    if (effort) next.effort = effort
    else delete next.effort
  }
  if ('thinking' in patch) {
    if (typeof patch.thinking === 'boolean') next.thinking = patch.thinking
    else delete next.thinking
  }
  if ('fast' in patch) {
    if (typeof patch.fast === 'boolean') next.fast = patch.fast
    else delete next.fast
  }
  writePlane({ model: plane.model, seats: { ...(plane.seats ?? {}), [id]: next } }, home)
}

export function mouthModel(home = automatonHome()): string {
  return process.env.AUTOMATON_MOUTH_MODEL?.trim() || seatModel(home)
}

/** Seat pin if present, else the shared default. Env still wins as today. */
export function mouthModelFor(agentId: string, home = automatonHome()): string {
  const mouthEnv = process.env.AUTOMATON_MOUTH_MODEL?.trim()
  if (mouthEnv) return mouthEnv
  const modelEnv = process.env.AUTOMATON_MODEL?.trim()
  if (modelEnv) return modelEnv
  const bound = seatBinding(agentId, home).model?.trim()
  if (bound) return bound
  return seatModel(home)
}

export function jobModel(home = automatonHome()): string {
  return process.env.AUTOMATON_JOB_MODEL?.trim() || seatModel(home)
}
