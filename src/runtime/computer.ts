import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { automatonHome } from './keys'

/** One shared Automaton computer. Mouths are users of this machine, not VMs. */
export const BOX_NAME = 'automaton-computer'
export const BOX_IMAGE = 'automaton-computer:local'
export const BOX_CHROME = 'chromium'
export const BOX_DISPLAY_W = 1280
export const BOX_DISPLAY_H = 800

const SEED_DISPLAY: Record<string, number> = {
  staff: 1,
  kernel: 2,
  research: 3,
}

export type MouthScreen = {
  agentId: string
  display: number
  profileDir: string
}

export type ComputerState = {
  name: string
  screens: Record<string, number>
}

export function computerRoot(home = automatonHome()): string {
  return home
}

export function computerStatePath(home = automatonHome()): string {
  return join(computerRoot(home), 'computer.json')
}

export function desktopsRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'desktops')
}

export function configsDir(home = automatonHome()): string {
  return join(computerRoot(home), 'configs')
}

export function sandboxesDir(home = automatonHome()): string {
  return join(computerRoot(home), 'sandboxes')
}

export function inboxRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'inbox')
}

export function skillsRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'skills')
}

export function connectorsPath(home = automatonHome()): string {
  return join(computerRoot(home), 'connectors.json')
}

export function parseComputerState(raw: unknown): ComputerState {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const screens =
    row.screens && typeof row.screens === 'object' && !Array.isArray(row.screens)
      ? Object.fromEntries(
          Object.entries(row.screens as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] > 0,
          ),
        )
      : {}
  return { name: BOX_NAME, screens }
}

export function readComputerState(home = automatonHome()): ComputerState {
  const path = computerStatePath(home)
  if (!existsSync(path)) return { name: BOX_NAME, screens: { ...SEED_DISPLAY } }
  try {
    return parseComputerState(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { name: BOX_NAME, screens: { ...SEED_DISPLAY } }
  }
}

export function writeComputerState(state: ComputerState, home = automatonHome()): ComputerState {
  const next = parseComputerState(state)
  mkdirSync(computerRoot(home), { recursive: true })
  writeFileSync(computerStatePath(home), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function assignDisplay(agentId: string, home = automatonHome()): number {
  const seeded = SEED_DISPLAY[agentId]
  const state = readComputerState(home)
  if (state.screens[agentId]) return state.screens[agentId]
  const display = seeded ?? Math.max(0, ...Object.values(state.screens)) + 1
  writeComputerState({ ...state, screens: { ...state.screens, [agentId]: display } }, home)
  return display
}

export function mouthScreen(agentId: string, home = automatonHome()): MouthScreen {
  return {
    agentId,
    display: assignDisplay(agentId, home),
    profileDir: join(desktopsRoot(home), agentId, 'browser'),
  }
}

export function boxProfileDir(agentId: string): string {
  return `/home/box/desktops/${agentId}/box-chrome`
}

export function sameComputer(_left: string, _right: string): boolean {
  return true
}
