import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { automatonHome } from './keys'
import { runningTests } from './test-env'

/** One OpenRouter model for every mouth and every Puppetmaster job. */
export const DEFAULT_SEAT_MODEL = 'openai/gpt-4o-mini'

export type SeatPlane = { model: string }

export function planePath(home = automatonHome()): string {
  return join(home, 'plane.json')
}

export function parsePlane(raw: unknown): SeatPlane {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  return { model: model || DEFAULT_SEAT_MODEL }
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
  writeFileSync(planePath(home), `${JSON.stringify({ model: parsePlane(plane).model }, null, 2)}\n`)
}

export function seatModel(home = automatonHome()): string {
  const env = process.env.AUTOMATON_MODEL?.trim()
  if (env) return env
  if (runningTests() && !process.env.AUTOMATON_HOME?.trim() && home === join(homedir(), '.automaton')) {
    return DEFAULT_SEAT_MODEL
  }
  return readPlane(home).model
}

export function mouthModel(home = automatonHome()): string {
  return process.env.AUTOMATON_MOUTH_MODEL?.trim() || seatModel(home)
}

export function jobModel(home = automatonHome()): string {
  return process.env.AUTOMATON_JOB_MODEL?.trim() || seatModel(home)
}
