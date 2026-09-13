import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentId } from '../domain'
import { automatonHome } from './keys'

/** Named multi-agent room — local in-app only (not Slack). */
export type Room = {
  id: string
  name: string
  memberIds: AgentId[]
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export type RoomDelivery = {
  toId: AgentId
  fromId: AgentId
  roomId: string
  roomName: string
  text: string
}

export type PostToRoomResult = {
  room: Room
  deliveries: RoomDelivery[]
  /** Sender-visible relay copy (fanout-style "sent to room"). */
  sentRelayText: string
}

let roomSeq = 0

export function resetRoomIdsForTests(): void {
  roomSeq = 0
}

function nextRoomId(): string {
  roomSeq += 1
  return `room_${Date.now().toString(36)}_${roomSeq}`
}

export function roomsPath(home = automatonHome()): string {
  return join(home, 'rooms.json')
}

function nowIso(now = () => new Date().toISOString()): string {
  return now()
}

function uniqIds(ids: AgentId[]): AgentId[] {
  const seen = new Set<string>()
  const out: AgentId[] = []
  for (const id of ids) {
    const trimmed = typeof id === 'string' ? id.trim() : ''
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function normalizeRoom(row: Record<string, unknown>): Room | null {
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : ''
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : ''
  if (!id || !name) return null
  const memberIds = Array.isArray(row.memberIds)
    ? uniqIds(row.memberIds.filter((id): id is string => typeof id === 'string'))
    : []
  const createdAt =
    typeof row.createdAt === 'string' && row.createdAt.trim() ? row.createdAt.trim() : nowIso()
  const updatedAt =
    typeof row.updatedAt === 'string' && row.updatedAt.trim() ? row.updatedAt.trim() : createdAt
  return {
    id,
    name,
    memberIds,
    archived: row.archived === true ? true : undefined,
    createdAt,
    updatedAt,
  }
}

function readRooms(home = automatonHome()): Room[] {
  const path = roomsPath(home)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((row) => row && typeof row === 'object')
      .map((row) => normalizeRoom(row as Record<string, unknown>))
      .filter((row): row is Room => row != null)
  } catch {
    return []
  }
}

function writeRooms(rows: Room[], home = automatonHome()): void {
  const path = roomsPath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
}

function putRoom(room: Room, home = automatonHome()): Room {
  const rows = readRooms(home)
  const hit = rows.findIndex((row) => row.id === room.id)
  const next = hit < 0 ? [...rows, room] : rows.map((row, i) => (i === hit ? room : row))
  writeRooms(next, home)
  return room
}

/** Active rooms first; archived last. */
export function listRooms(home = automatonHome(), opts?: { includeArchived?: boolean }): Room[] {
  const rows = readRooms(home)
  const filtered = opts?.includeArchived ? rows : rows.filter((row) => !row.archived)
  return filtered.slice().sort((a, b) => {
    if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

export function getRoom(roomId: string, home = automatonHome()): Room | null {
  const id = roomId.trim()
  if (!id) return null
  return readRooms(home).find((row) => row.id === id) ?? null
}

export function createRoom(
  input: { name: string; memberIds?: AgentId[] },
  home = automatonHome(),
  now = () => new Date().toISOString(),
): Room {
  const name = input.name.trim()
  if (!name) throw new Error('Room name required.')
  const at = now()
  const room: Room = {
    id: nextRoomId(),
    name,
    memberIds: uniqIds(input.memberIds ?? []),
    createdAt: at,
    updatedAt: at,
  }
  return putRoom(room, home)
}

export function updateRoomMembers(
  roomId: string,
  memberIds: AgentId[],
  home = automatonHome(),
  now = () => new Date().toISOString(),
): Room | null {
  const room = getRoom(roomId, home)
  if (!room) return null
  return putRoom(
    {
      ...room,
      memberIds: uniqIds(memberIds),
      updatedAt: now(),
    },
    home,
  )
}

export function renameRoom(
  roomId: string,
  name: string,
  home = automatonHome(),
  now = () => new Date().toISOString(),
): Room | null {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Room name required.')
  const room = getRoom(roomId, home)
  if (!room) return null
  return putRoom({ ...room, name: trimmed, updatedAt: now() }, home)
}

export function archiveRoom(
  roomId: string,
  home = automatonHome(),
  now = () => new Date().toISOString(),
): Room | null {
  const room = getRoom(roomId, home)
  if (!room) return null
  if (room.archived) return room
  return putRoom({ ...room, archived: true, updatedAt: now() }, home)
}

/** Hard delete — prefer Settings UI over silent drops. */
export function deleteRoom(roomId: string, home = automatonHome()): boolean {
  const id = roomId.trim()
  if (!id) return false
  const rows = readRooms(home)
  const next = rows.filter((row) => row.id !== id)
  if (next.length === rows.length) return false
  writeRooms(next, home)
  return true
}

/**
 * Optional judgment helper — strips obvious private-vent phrasing before peer/room relay.
 * Nice-to-have; callers may pass text through unchanged.
 */
export function sanitizePeerRelay(text: string): string {
  let out = text.trim()
  if (!out) return ''
  const patterns = [
    /\b(just between us|don't tell (anyone|the user|staff)|off the record)\b/gi,
    /\b(vent(?:ing)?|rant(?:ing)?)\b[:\s-]*/gi,
    /\b(private note to self)\b[:\s-]*/gi,
  ]
  for (const re of patterns) out = out.replace(re, '')
  return out
    .replace(/^[,:;\-–—\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Fan-out list for a room post. Excludes fromId from deliveries; caller paints
 * a sent-to-room relay on the sender thread (fanout style). Archived rooms refuse.
 */
export function postToRoom(
  roomId: string,
  input: { fromId: AgentId; text: string },
  home = automatonHome(),
): PostToRoomResult {
  const room = getRoom(roomId, home)
  if (!room) throw new Error('Room not found.')
  if (room.archived) throw new Error('Room is archived.')
  const fromId = input.fromId.trim()
  const text = input.text.trim()
  if (!fromId) throw new Error('fromId required.')
  if (!text) throw new Error('text required.')
  if (!room.memberIds.includes(fromId)) {
    throw new Error('Sender is not a room member.')
  }
  const body = sanitizePeerRelay(text) || text
  const deliveries: RoomDelivery[] = []
  for (const toId of room.memberIds) {
    if (toId === fromId) continue
    deliveries.push({
      toId,
      fromId,
      roomId: room.id,
      roomName: room.name,
      text: body,
    })
  }
  return {
    room,
    deliveries,
    sentRelayText: `Room ${room.name}: ${body}`,
  }
}
