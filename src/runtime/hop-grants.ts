/**
 * Wave 7 P1b — hop mayAddress grants (OpenBot handoff mayAddress pattern).
 *
 * Optional allowlist on the asking agent's profile (and optionally a room).
 * Missing / undefined = all visible sisters (preserve current UX). Explicit
 * empty list = nobody. Read per hop, never cached across turns.
 */
import type { AgentId } from '../domain'
import { buildActionEvent, type ActionEvent } from './mouth-stream'
import type { AgentProfile } from './profile'
import type { Room } from './rooms'

/** Normalize a grant list: trim, uniq, drop blanks. null/undefined stay open. */
export function normalizeMayAddressIds(
  raw: unknown,
): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Whether from may address to under optional grants.
 * Undefined grants → allow (default all visible; visibility is checked elsewhere).
 */
export function mayAddress(
  _fromId: AgentId,
  toId: AgentId,
  mayAddressIds?: readonly string[] | null,
): boolean {
  if (mayAddressIds === undefined || mayAddressIds === null) return true
  return mayAddressIds.includes(toId)
}

/** Merge profile + optional room allowlists (intersection when both set). */
export function effectiveMayAddressIds(
  profileIds?: readonly string[] | null,
  roomIds?: readonly string[] | null,
): string[] | undefined {
  const profile = profileIds === null ? undefined : profileIds === undefined ? undefined : [...profileIds]
  const room = roomIds === null ? undefined : roomIds === undefined ? undefined : [...roomIds]
  if (profile === undefined && room === undefined) return undefined
  if (profile === undefined) return room
  if (room === undefined) return profile
  const allow = new Set(room)
  return profile.filter((id) => allow.has(id))
}

export function mayAddressFromProfile(
  profile: Pick<AgentProfile, 'mayAddressIds'> | null | undefined,
  toId: AgentId,
): boolean {
  return mayAddress('_', toId, profile?.mayAddressIds)
}

export function mayAddressInRoom(
  room: Pick<Room, 'mayAddressIds'> | null | undefined,
  toId: AgentId,
): boolean {
  return mayAddress('_', toId, room?.mayAddressIds)
}

/** Spoken refuse — short Automaton style, not a thrown error. */
export function hopGrantRefusalLine(targetName: string): string {
  const name = targetName.trim() || 'them'
  return `Not allowed to hand that to ${name}.`
}

/** Durable ledger row for a grant refuse (no secrets). */
export function hopGrantRefusedEvent(input: {
  fromId: AgentId
  toId: AgentId
  initiatorKind?: ActionEvent['initiatorKind']
}): ActionEvent {
  return buildActionEvent({
    ownerAgentId: input.fromId,
    tool: 'hop',
    intent: 'hand_off',
    decision: 'refuse',
    reason: 'not_granted',
    path: input.toId,
    initiatorKind: input.initiatorKind ?? 'person',
  })
}
