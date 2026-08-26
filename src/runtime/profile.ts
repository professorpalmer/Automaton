import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentKit } from '../domain'
import { automatonHome } from './keys'

export type { AgentKit }
export type AgentProfile = {
  id: string
  name: string
  title: string
  description: string
  rules: string
  kit: AgentKit
  avatarShape: string
  avatarColor: string
  namedBy: 'user' | 'app'
  skillIds: string[]
  notifyOnUpdates: boolean
  hiddenFromRail: boolean
  createdAt: string
}

const KITS: AgentKit[] = ['coordinator', 'code', 'lookup', 'blank']

export function agentsRoot(home = automatonHome()): string {
  return join(home, 'agents')
}

export function agentDir(id: string, home = automatonHome()): string {
  return join(agentsRoot(home), id)
}

export function profilePath(id: string, home = automatonHome()): string {
  return join(agentDir(id, home), 'profile.json')
}

function asKit(value: unknown): AgentKit {
  return typeof value === 'string' && KITS.includes(value as AgentKit) ? (value as AgentKit) : 'blank'
}

export function seedKit(id: string): AgentKit {
  if (id === 'staff') return 'coordinator'
  if (id === 'kernel') return 'code'
  if (id === 'research') return 'lookup'
  return 'blank'
}

export function parseProfile(raw: unknown, fallbackId: string): AgentProfile {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const skillIds = Array.isArray(row.skillIds)
    ? row.skillIds.filter((item): item is string => typeof item === 'string')
    : []
  return {
    id: typeof row.id === 'string' && row.id ? row.id : fallbackId,
    name: typeof row.name === 'string' ? row.name : 'New Bot',
    title: typeof row.title === 'string' ? row.title : '',
    description: typeof row.description === 'string' ? row.description : '',
    rules: typeof row.rules === 'string' ? row.rules : '',
    kit: asKit(row.kit),
    avatarShape: typeof row.avatarShape === 'string' ? row.avatarShape : '',
    avatarColor: typeof row.avatarColor === 'string' ? row.avatarColor : '',
    namedBy: row.namedBy === 'user' ? 'user' : 'app',
    skillIds,
    notifyOnUpdates: row.notifyOnUpdates !== false,
    hiddenFromRail: row.hiddenFromRail === true,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
  }
}

export function readProfile(id: string, home = automatonHome()): AgentProfile | null {
  const path = profilePath(id, home)
  if (!existsSync(path)) return null
  try {
    return parseProfile(JSON.parse(readFileSync(path, 'utf8')), id)
  } catch {
    return null
  }
}

export function writeProfile(profile: AgentProfile, home = automatonHome()): void {
  const dir = agentDir(profile.id, home)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'memory'), { recursive: true })
  mkdirSync(join(dir, 'automations'), { recursive: true })
  writeFileSync(profilePath(profile.id, home), `${JSON.stringify(profile, null, 2)}\n`)
}

export function deleteProfile(id: string, home = automatonHome()): void {
  const dir = agentDir(id, home)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function kitForAgent(id: string, home = automatonHome()): AgentKit {
  return readProfile(id, home)?.kit ?? seedKit(id)
}

export function listProfileIds(home = automatonHome()): string[] {
  const root = agentsRoot(home)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((id) => existsSync(profilePath(id, home)))
}

export function seedProfile(id: 'staff' | 'kernel' | 'research'): AgentProfile {
  const meta =
    id === 'staff'
      ? { name: 'Staff', title: 'Coordinator', description: 'Replies, books work, dispatches. Does not do multi-file jobs.' }
      : id === 'kernel'
        ? { name: 'Kernel', title: 'Code', description: 'Puppetmaster / code. Speaks, then dispatches implement.' }
        : { name: 'Research', title: 'Wiki / web', description: 'Looks things up. Speaks, then dispatches analysis.' }
  return {
    id,
    ...meta,
    rules: '',
    kit: seedKit(id),
    avatarShape: id === 'staff' ? 'blob' : id === 'kernel' ? 'hex' : 'tablet',
    avatarColor: id,
    namedBy: 'app',
    skillIds: [],
    notifyOnUpdates: true,
    hiddenFromRail: false,
    createdAt: '1970-01-01T00:00:00.000Z',
  }
}

export function ensureSeedProfiles(home = automatonHome()): void {
  for (const id of ['staff', 'kernel', 'research'] as const) {
    if (readProfile(id, home)) continue
    writeProfile(seedProfile(id), home)
  }
}
