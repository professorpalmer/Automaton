import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextId, type Agent, type HomeBind } from '../domain'
import type { Session } from '../session'
import { addLiveAgent, idleOrphanMouths, normalizeSession } from '../session'
import { MARK_BAKE_REV, MARK_FRAMES, writeFrame, type MarkFrame } from '../../scripts/bake-marks'
import { T } from '../tokens'
import { deal, markForId, seedOverride } from './deal'
import { resolveHomePath } from './home'
import { teardownBrowserDesktop } from './chrome'
import { ensureDesktop } from './desktop'
import { automatonHome } from './keys'
import {
  deleteProfile,
  ensureSeedProfiles,
  listProfileIds,
  readProfile,
  type AgentKit,
  type AgentProfile,
  writeProfile,
} from './profile'

const SHIPPED_MARKS = join(import.meta.dir, '..', 'marks')

export const FACTORY_NAME = 'New automaton'

export function catalogHex(tint: string): string {
  if (tint === 'staff') return T.staff.face
  if (tint === 'kernel') return T.kernel.face
  if (tint === 'research') return T.research.face
  const named = (T.catalog as Record<string, string>)[tint]
  return named ?? T.catalog.gray
}

export function shippedFramePath(shape: string, tint: string, frame: MarkFrame): string {
  return join(SHIPPED_MARKS, shape, tint, `${frame}.png`)
}

export function cacheFramePath(shape: string, tint: string, frame: MarkFrame, home = automatonHome()): string {
  return join(home, 'marks', shape, tint, `${frame}.png`)
}

export function resolveFramePath(shape: string, tint: string, frame: MarkFrame, home = automatonHome()): string {
  const shipped = shippedFramePath(shape, tint, frame)
  if (existsSync(shipped)) return shipped
  return cacheFramePath(shape, tint, frame, home)
}

export function ensureMarkFrames(shape: string, tint: string, home = automatonHome()): void {
  const hex = catalogHex(tint)
  const cacheRoot = join(home, 'marks')
  const stampDir = join(cacheRoot, shape, tint)
  const stamp = join(stampDir, '.rev')
  let stamped = ''
  try {
    stamped = readFileSync(stamp, 'utf8').trim()
  } catch {
    stamped = ''
  }
  const stale = stamped !== String(MARK_BAKE_REV)
  for (const frame of MARK_FRAMES) {
    if (existsSync(shippedFramePath(shape, tint, frame))) continue
    if (!stale && existsSync(cacheFramePath(shape, tint, frame, home))) continue
    writeFrame(cacheRoot, shape, tint, hex, frame)
  }
  mkdirSync(stampDir, { recursive: true })
  writeFileSync(stamp, String(MARK_BAKE_REV))
}

export function liveAgentFromProfile(profile: AgentProfile): Agent {
  return {
    id: profile.id,
    name: profile.name,
    title: profile.title,
    description: profile.description,
    color: catalogHex(profile.avatarColor || 'gray'),
    hidden: profile.hiddenFromRail,
  }
}

export function createAgent(input?: {
  name?: string
  kit?: AgentKit
  home?: string
}): { agent: Agent; profile: AgentProfile } {
  const home = input?.home ?? automatonHome()
  const id = nextId('agent')
  const mark = seedOverride(id) ?? deal(id)
  const profile: AgentProfile = {
    id,
    name: input?.name?.trim() || FACTORY_NAME,
    title: '',
    description: '',
    rules: '',
    kit: input?.kit ?? 'code',
    avatarShape: mark.shape,
    avatarColor: mark.color,
    namedBy: input?.name?.trim() ? 'user' : 'app',
    skillIds: [],
    notifyOnUpdates: true,
    hiddenFromRail: false,
    createdAt: new Date().toISOString(),
    homeRepo: '',
    homePath: '',
  }
  writeProfile(profile, home)
  ensureMarkFrames(profile.avatarShape, profile.avatarColor, home)
  ensureDesktop(profile.id, home)
  return { agent: liveAgentFromProfile(profile), profile }
}

export function applyHomeBinds(
  binds: HomeBind[],
  home = automatonHome(),
): Agent[] {
  const live: Agent[] = []
  for (const bind of binds) {
    const profile = readProfile(bind.agentId, home)
    if (!profile) continue
    const path = resolveHomePath(bind.slug) ?? ''
    const next = {
      ...profile,
      homeRepo: bind.slug,
      homePath: path,
      title: bind.slug,
      description: `On ${bind.slug} for product work. Not Automaton.`,
    }
    writeProfile(next, home)
    live.push(liveAgentFromProfile(next))
  }
  return live
}

export function destroyAgent(id: string, home = automatonHome()): void {
  teardownBrowserDesktop(id, home)
  deleteProfile(id, home)
}

export function markForAgent(id: string, home = automatonHome()): { shape: string; color: string } {
  return markForId(id, readProfile(id, home))
}

export function hydrateSession(session: Session, home = automatonHome()): Session {
  ensureSeedProfiles(home)
  const onDisk = new Set(listProfileIds(home))
  onDisk.add('staff')
  const normalized = normalizeSession(session)
  const agents = normalized.agents.filter((agent) => onDisk.has(agent.id))
  const threads = Object.fromEntries(
    Object.entries(normalized.threads).filter(([id]) => onDisk.has(id)),
  )
  const activeAgentId = agents.some((agent) => agent.id === normalized.activeAgentId)
    ? normalized.activeAgentId
    : 'staff'
  const jobs = normalized.jobs.filter((job) => onDisk.has(job.ownerAgentId))
  const goals = (normalized.goals ?? []).filter((goal) => onDisk.has(goal.ownerAgentId))
  let next: Session = { ...normalized, agents, threads, jobs, goals, activeAgentId }
  for (const id of listProfileIds(home)) {
    const profile = readProfile(id, home)
    if (!profile) continue
    ensureDesktop(id, home)
    if (profile.avatarShape && profile.avatarColor) {
      ensureMarkFrames(profile.avatarShape, profile.avatarColor, home)
    }
    const live = liveAgentFromProfile(profile)
    if (!next.agents.some((agent) => agent.id === id)) {
      next = addLiveAgent(next, live, false)
      continue
    }
    next = {
      ...next,
      agents: next.agents.map((agent) => (agent.id === id ? live : agent)),
    }
    if (!next.threads[id]) {
      next = addLiveAgent(next, live, false)
    }
  }
  return idleOrphanMouths(next)
}
