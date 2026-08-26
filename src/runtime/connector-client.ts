import {
  OPENROUTER_ID,
  type Connector,
  readConnectors,
  upsertConnector,
} from './connectors'
import { automatonHome, listOpenRouterKeys, type ResolvedKey } from './keys'

export const OPENROUTER_MODELS_PATH = '/api/v1/models'
export const OPENROUTER_CHAT_PATH = '/api/v1/chat/completions'

export type ConnectorFetchSeams = {
  fetch?: typeof fetch
  bearer?: string
  home?: string
  keys?: () => ResolvedKey[]
}

export type ProbeSeams = {
  fetch?: typeof fetch
  keys?: () => ResolvedKey[]
  now?: () => number
}

function joinUrl(base: string, path: string): string {
  const root = base.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${root}${suffix}`
}

function grantFor(id: string, seams?: ConnectorFetchSeams): string {
  if (seams?.bearer) return seams.bearer
  if (id !== OPENROUTER_ID) return ''
  const keys = seams?.keys?.() ?? listOpenRouterKeys()
  return keys[0]?.key ?? ''
}

export async function connectorFetch(
  id: string,
  path: string,
  init?: RequestInit,
  seams?: ConnectorFetchSeams,
): Promise<Response> {
  const home = seams?.home ?? automatonHome()
  const row = readConnectors(home).find((item) => item.id === id)
  if (!row) throw new Error(`unknown connector ${id}`)
  const bearer = grantFor(id, seams)
  if (row.needsAuth && !bearer) throw new Error('openrouter missing key')
  const headers = new Headers(init?.headers)
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  if (!headers.has('HTTP-Referer')) {
    headers.set('HTTP-Referer', 'https://github.com/professorpalmer')
  }
  if (!headers.has('X-Title')) headers.set('X-Title', 'Automaton')
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const fn = seams?.fetch ?? fetch
  return fn(joinUrl(row.baseUrl, path), { ...init, headers })
}

export async function readSseDataLine(response: Response): Promise<string | null> {
  const text = await response.text()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue
    return payload
  }
  return null
}

export async function probeConnector(
  id: string,
  home = automatonHome(),
  seams?: ProbeSeams,
): Promise<Connector> {
  const row = readConnectors(home).find((item) => item.id === id)
  if (!row) throw new Error(`unknown connector ${id}`)
  const keys = seams?.keys?.() ?? (id === OPENROUTER_ID ? listOpenRouterKeys() : [])
  if (row.needsAuth && keys.length === 0) {
    return upsertConnector(
      id,
      { connected: false, lastError: null },
      home,
    )
  }
  const now = seams?.now ?? Date.now
  try {
    const response = await connectorFetch(
      id,
      id === OPENROUTER_ID ? OPENROUTER_MODELS_PATH : '/',
      { method: 'GET' },
      { fetch: seams?.fetch, home, keys: () => keys },
    )
    if (response.status === 200) {
      return upsertConnector(
        id,
        { connected: true, lastError: null, lastProbeAt: now() },
        home,
      )
    }
    if (response.status === 401 || response.status === 403) {
      return upsertConnector(
        id,
        { connected: false, lastError: 'rejected', lastProbeAt: now() },
        home,
      )
    }
    return upsertConnector(
      id,
      { connected: false, lastError: 'unreachable', lastProbeAt: now() },
      home,
    )
  } catch {
    return upsertConnector(
      id,
      { connected: false, lastError: 'unreachable', lastProbeAt: now() },
      home,
    )
  }
}
