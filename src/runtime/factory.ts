import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../domain'
import { nextId } from '../domain'
import type { Session } from '../session'
import { addLiveAgent, idleOrphanMouths } from '../session'
import { MARK_FRAMES, writeFrame, type MarkFrame } from '../../scripts/bake-marks'
import { T } from '../tokens'
import { deal, markForId, seedOverride } from './deal'
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
  for (const frame of MARK_FRAMES) {
    if (existsSync(resolveFramePath(shape, tint, frame, home))) continue
    writeFrame(cacheRoot, shape, tint, hex, frame)
  }
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
    name: input?.name?.trim() || 'New Bot',
    title: '',
    description: '',
    rules: '',
    kit: input?.kit ?? 'blank',
    avatarShape: mark.shape,
    avatarColor: mark.color,
    namedBy: input?.name?.trim() ? 'user' : 'app',
    skillIds: [],
    notifyOnUpdates: true,
    hiddenFromRail: false,
    createdAt: new Date().toISOString(),
  }
  writeProfile(profile, home)
  ensureMarkFrames(profile.avatarShape, profile.avatarColor, home)
  ensureDesktop(profile.id, home)
  return { agent: liveAgentFromProfile(profile), profile }
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
  let next = session
  for (const id of listProfileIds(home)) {
    const profile = readProfile(id, home)
    if (!profile) continue
    ensureDesktop(id, home)
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
