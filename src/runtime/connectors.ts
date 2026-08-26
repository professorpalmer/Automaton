import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { connectorsPath } from './computer'
import { automatonHome, listOpenRouterKeys } from './keys'

export const OPENROUTER_ID = 'openrouter'
export const OPENROUTER_ORIGIN = 'https://openrouter.ai'

export type ConnectorTransport = 'http' | 'sse'

export type Connector = {
  id: string
  name: string
  needsAuth: boolean
  connected: boolean
  transport: ConnectorTransport
  baseUrl: string
  lastProbeAt: number | null
  lastError: string | null
}

export function defaultOpenRouter(): Connector {
  return {
    id: OPENROUTER_ID,
    name: 'OpenRouter',
    needsAuth: true,
    connected: false,
    transport: 'http',
    baseUrl: OPENROUTER_ORIGIN,
    lastProbeAt: null,
    lastError: null,
  }
}

function defaults(): Connector[] {
  return [defaultOpenRouter()]
}

function asTransport(value: unknown): ConnectorTransport {
  return value === 'sse' ? 'sse' : 'http'
}

function asLastError(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asLastProbeAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalize(row: Record<string, unknown>): Connector {
  const id = typeof row.id === 'string' && row.id ? row.id : 'unknown'
  const fallback = id === OPENROUTER_ID ? defaultOpenRouter() : null
  return {
    id,
    name: typeof row.name === 'string' && row.name ? row.name : fallback?.name ?? 'Connector',
    needsAuth: row.needsAuth !== false,
    connected: row.connected === true,
    transport: asTransport(row.transport),
    baseUrl:
      typeof row.baseUrl === 'string' && row.baseUrl.trim()
        ? row.baseUrl.trim().replace(/\/$/, '')
        : fallback?.baseUrl ?? OPENROUTER_ORIGIN,
    lastProbeAt: asLastProbeAt(row.lastProbeAt),
    lastError: asLastError(row.lastError),
  }
}

export function readConnectors(home = automatonHome()): Connector[] {
  const path = connectorsPath(home)
  if (!existsSync(path)) return defaults()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!Array.isArray(raw)) return defaults()
    const rows = raw
      .filter((row) => row && typeof row === 'object')
      .map((row) => normalize(row as Record<string, unknown>))
    if (!rows.some((row) => row.id === OPENROUTER_ID)) return [...defaults(), ...rows]
    return rows
  } catch {
    return defaults()
  }
}

export function writeConnectors(rows: Connector[], home = automatonHome()): void {
  const path = connectorsPath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`)
}

export function upsertConnector(
  id: string,
  patch: Partial<Connector>,
  home = automatonHome(),
): Connector {
  const rows = readConnectors(home)
  let found: Connector | undefined
  const next = rows.map((row) => {
    if (row.id !== id) return row
    found = { ...row, ...patch, id: row.id }
    return found
  })
  if (!found) throw new Error(`unknown connector ${id}`)
  writeConnectors(next, home)
  return found
}

export function markConnected(id: string, connected: boolean, home = automatonHome()): Connector[] {
  upsertConnector(id, { connected }, home)
  return readConnectors(home)
}

export function connectorStatusLabel(row: Connector): string {
  if (row.lastError === 'rejected') return 'Rejected'
  if (row.lastError === 'unreachable') return 'Unreachable'
  if (row.connected) return 'Connected'
  return 'Needs key'
}

export function hasOpenRouterGrant(): boolean {
  return listOpenRouterKeys().length > 0
}
