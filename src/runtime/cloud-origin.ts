/**
 * Optional Cursor Cloud Agent / Origin transport (public HTTP only).
 * Not required for local Docker box + Mac staff. Fail soft when unavailable.
 * Never imports private @anysphere packages or invents Cursor-internal endpoints.
 */

import { spawnSync } from 'node:child_process'

export const CLOUD_AGENTS_API_BASE = 'https://api.cursor.com/v0'
export const CLOUD_ORIGIN_DOCS = 'docs/cloud-origin.md'

/** Public Cloud Agents dashboard / agent deep link host. */
export const CURSOR_AGENTS_HOST = 'https://cursor.com/agents'

/** Origin forge clone host — only use when the remote already points here. */
export const ORIGIN_CLONE_HOST = 'origin.cursor.com'

/** Origin browse surface (early beta). */
export const ORIGIN_BROWSE_BASE = 'https://cursor.com/codebase'

export type CloudPresenceStatus = 'ready' | 'parked' | 'warn'

export type CloudParkReason =
  | 'missing_key'
  | 'privacy_mode'
  | 'unavailable'
  | 'auth_failed'

export type CloudPresence = {
  status: CloudPresenceStatus
  /** Parked / unavailable reasons — empty when ready. */
  reason?: CloudParkReason
  note: string
  apiKeyName?: string
  /** True only when launchCloudImplement is allowed to call the API. */
  launchable: boolean
}

export type CloudAgentSnapshot = {
  id: string
  name: string
  status: string
  repository?: string
  ref?: string
  agentUrl?: string
  prUrl?: string
  branchName?: string
  summary?: string
  createdAt?: string
}

export type LaunchCloudImplementInput = {
  /** GitHub repository URL (required by the public Cloud Agents API). */
  repository: string
  prompt: string
  ref?: string
  autoCreatePr?: boolean
  name?: string
  model?: string
}

export type CloudResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; parked?: boolean; reason?: CloudParkReason }

export type CloudHttpResponse = {
  status: number
  text: string
}

export type CloudOriginSeams = {
  apiKey?: () => string | undefined
  fetch?: (url: string, init: RequestInit) => Promise<CloudHttpResponse>
  apiBase?: string
}

function readApiKey(seams?: CloudOriginSeams): string | undefined {
  // When a seam is provided, honor it fully (including unset) so tests do not
  // accidentally fall through to the machine CURSOR_API_KEY.
  if (seams && Object.prototype.hasOwnProperty.call(seams, 'apiKey')) {
    return seams.apiKey?.()?.trim() || undefined
  }
  const fromEnv = process.env.CURSOR_API_KEY?.trim()
  return fromEnv || undefined
}

function authHeader(apiKey: string): string {
  // Documented Basic auth: API key as username, empty password.
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`
}

async function defaultFetch(url: string, init: RequestInit): Promise<CloudHttpResponse> {
  const res = await fetch(url, init)
  return { status: res.status, text: await res.text() }
}

async function cloudRequest(
  path: string,
  init: { method?: string; body?: unknown },
  seams?: CloudOriginSeams,
): Promise<CloudResult<{ status: number; json: unknown; text: string }>> {
  const apiKey = readApiKey(seams)
  if (!apiKey) {
    return {
      ok: false,
      parked: true,
      reason: 'missing_key',
      error: `Need: CURSOR_API_KEY unset — cloud agent parked (${CLOUD_ORIGIN_DOCS}).`,
    }
  }
  const base = (seams?.apiBase ?? CLOUD_AGENTS_API_BASE).replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Authorization: authHeader(apiKey),
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let response: CloudHttpResponse
  try {
    const doFetch = seams?.fetch ?? defaultFetch
    response = await doFetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    return {
      ok: false,
      error: `Need: cloud agent request failed (${err instanceof Error ? err.message : String(err)}).`,
    }
  }
  let json: unknown = null
  if (response.text.trim()) {
    try {
      json = JSON.parse(response.text)
    } catch {
      json = null
    }
  }
  return { ok: true, value: { status: response.status, json, text: response.text } }
}

function errorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback
  const row = json as Record<string, unknown>
  if (typeof row.error === 'string' && row.error.trim()) return row.error.trim()
  if (row.error && typeof row.error === 'object') {
    const nested = row.error as Record<string, unknown>
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim()
  }
  if (typeof row.message === 'string' && row.message.trim()) return row.message.trim()
  return fallback
}

function classifyApiFailure(status: number, message: string): {
  parked: boolean
  reason: CloudParkReason
  note: string
} {
  const lower = message.toLowerCase()
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid.?api.?key/i.test(message)) {
    return {
      parked: true,
      reason: 'auth_failed',
      note: `Cloud agent auth failed (${status}) — check CURSOR_API_KEY (${CLOUD_ORIGIN_DOCS}).`,
    }
  }
  if (/privacy mode/i.test(message) || lower.includes('not supported in privacy')) {
    return {
      parked: true,
      reason: 'privacy_mode',
      note: `Cloud agent parked: account Privacy Mode (Legacy) blocks Cloud Agents API (${CLOUD_ORIGIN_DOCS}).`,
    }
  }
  return {
    parked: true,
    reason: 'unavailable',
    note: `Cloud agent unavailable (${status}): ${message.slice(0, 200)} — see ${CLOUD_ORIGIN_DOCS}.`,
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseCloudAgentPayload(raw: unknown): CloudAgentSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = asString(row.id)
  if (!id) return null
  const source =
    row.source && typeof row.source === 'object' ? (row.source as Record<string, unknown>) : null
  const target =
    row.target && typeof row.target === 'object' ? (row.target as Record<string, unknown>) : null
  return {
    id,
    name: asString(row.name) ?? id,
    status: asString(row.status) ?? 'UNKNOWN',
    repository: asString(source?.repository) ?? asString(source?.repoUrl),
    ref: asString(source?.ref),
    agentUrl: asString(target?.url) ?? `${CURSOR_AGENTS_HOST}?id=${encodeURIComponent(id)}`,
    prUrl: asString(target?.prUrl),
    branchName: asString(target?.branchName),
    summary: asString(row.summary),
    createdAt: asString(row.createdAt),
  }
}

/** Normalize a GitHub https/ssh URL for the Cloud Agents `source.repository` field. */
export function normalizeGithubRepositoryUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let s = trimmed.replace(/\.git$/i, '')
  s = s.replace(/^git@github\.com:/i, 'https://github.com/')
  s = s.replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, 'https://github.com/')
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/i.test(s)) return null
  return s
}

/** Map a profile `homeRepo` slug or URL to a GitHub repository URL for cloud launch. */
export function githubUrlFromHomeRepo(homeRepo: string): string | null {
  const trimmed = homeRepo.trim()
  if (!trimmed) return null
  const asUrl = normalizeGithubRepositoryUrl(trimmed)
  if (asUrl) return asUrl
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`
  }
  return null
}

export type OriginRepoRef = {
  owner: string
  repo: string
  cloneUrl: string
  browseUrl: string
}

/**
 * Parse an Origin forge remote. Never invents Origin slugs from GitHub URLs —
 * only accepts origin.cursor.com hosts (or an explicit Origin clone URL).
 */
export function parseOriginRemote(raw: string): OriginRepoRef | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let s = trimmed.replace(/\.git$/i, '')
  s = s.replace(/^git@origin\.cursor\.com:/i, `https://${ORIGIN_CLONE_HOST}/`)
  s = s.replace(/^ssh:\/\/git@origin\.cursor\.com\//i, `https://${ORIGIN_CLONE_HOST}/`)
  s = s.replace(/^https?:\/\/origin\.cursor\.com\//i, `https://${ORIGIN_CLONE_HOST}/`)
  const match = /^https:\/\/origin\.cursor\.com\/([^/]+)\/([^/]+)\/?$/i.exec(s)
  if (!match) return null
  const owner = match[1]
  const repo = match[2]
  return {
    owner,
    repo,
    cloneUrl: `https://${ORIGIN_CLONE_HOST}/${owner}/${repo}.git`,
    browseUrl: `${ORIGIN_BROWSE_BASE}/${owner}/${repo}`,
  }
}

/**
 * Honesty guard: never map github.com → Origin. Callers must supply an Origin remote.
 */
export function neverGuessOriginFromGithub(_githubUrl: string): null {
  return null
}

export function cloudPresenceLabel(presence: CloudPresence): string {
  if (presence.launchable) return 'ready'
  if (presence.reason === 'missing_key') return 'parked · no CURSOR_API_KEY'
  if (presence.reason === 'privacy_mode') return 'parked · privacy mode'
  if (presence.reason === 'auth_failed') return 'parked · auth failed'
  return 'parked · unavailable'
}

/**
 * Probe whether the public Cloud Agents API can launch from this machine.
 * Soft: never throws; returns parked when key missing or account blocks cloud.
 */
export async function probeCloudPresence(seams?: CloudOriginSeams): Promise<CloudPresence> {
  const apiKey = readApiKey(seams)
  if (!apiKey) {
    return {
      status: 'parked',
      reason: 'missing_key',
      launchable: false,
      note: `Cloud agent / Origin parked (opt-in) — set CURSOR_API_KEY to enable (${CLOUD_ORIGIN_DOCS}).`,
    }
  }

  const me = await cloudRequest('/me', { method: 'GET' }, seams)
  if (!me.ok) {
    return {
      status: 'parked',
      reason: me.reason ?? 'unavailable',
      launchable: false,
      note: me.error,
    }
  }
  if (me.value.status === 401 || me.value.status === 403) {
    const classified = classifyApiFailure(
      me.value.status,
      errorMessage(me.value.json, me.value.text || 'auth failed'),
    )
    return {
      status: 'warn',
      reason: classified.reason,
      launchable: false,
      note: classified.note,
    }
  }
  if (me.value.status < 200 || me.value.status >= 300) {
    const classified = classifyApiFailure(
      me.value.status,
      errorMessage(me.value.json, me.value.text || 'me failed'),
    )
    return {
      status: 'warn',
      reason: classified.reason,
      launchable: false,
      note: classified.note,
    }
  }

  const meJson =
    me.value.json && typeof me.value.json === 'object'
      ? (me.value.json as Record<string, unknown>)
      : null
  const apiKeyName = asString(meJson?.apiKeyName)

  // Listing agents exercises the Cloud Agents product surface (privacy mode, etc.).
  const list = await cloudRequest('/agents?limit=1', { method: 'GET' }, seams)
  if (!list.ok) {
    return {
      status: 'parked',
      reason: list.reason ?? 'unavailable',
      launchable: false,
      note: list.error,
      apiKeyName,
    }
  }
  if (list.value.status < 200 || list.value.status >= 300) {
    const classified = classifyApiFailure(
      list.value.status,
      errorMessage(list.value.json, list.value.text || 'list failed'),
    )
    return {
      status: classified.reason === 'privacy_mode' ? 'parked' : 'warn',
      reason: classified.reason,
      launchable: false,
      note: classified.note,
      apiKeyName,
    }
  }

  return {
    status: 'ready',
    launchable: true,
    apiKeyName,
    note: `Cloud agent API ready${apiKeyName ? ` (${apiKeyName})` : ''} — optional transport; local PM jobs still own durable work (${CLOUD_ORIGIN_DOCS}).`,
  }
}

/** Synchronous doctor helper — uses injected presence or a parked default (no network in CI). */
export function doctorCloudOrigin(presence?: CloudPresence): {
  status: 'ok' | 'warn' | 'parked'
  note: string
} {
  if (!presence) {
    return {
      status: 'parked',
      note: `cloud / Origin checklist: ${CLOUD_ORIGIN_DOCS} (live probe: AUTOMATON_CLOUD_PROBE=1 bun run doctor)`,
    }
  }
  if (presence.launchable) {
    return { status: 'ok', note: presence.note }
  }
  if (presence.status === 'parked') {
    return { status: 'parked', note: presence.note }
  }
  return { status: 'warn', note: presence.note }
}

export async function launchCloudImplement(
  input: LaunchCloudImplementInput,
  seams?: CloudOriginSeams,
): Promise<CloudResult<CloudAgentSnapshot>> {
  const repository = normalizeGithubRepositoryUrl(input.repository)
  if (!repository) {
    return {
      ok: false,
      error: 'Need: cloud implement requires a github.com repository URL (not Origin — Origin remotes stay Origin).',
    }
  }
  const prompt = input.prompt.trim()
  if (!prompt) {
    return { ok: false, error: 'Need: cloud implement prompt is empty.' }
  }

  const body: Record<string, unknown> = {
    prompt: { text: prompt },
    source: {
      repository,
      ...(input.ref?.trim() ? { ref: input.ref.trim() } : {}),
    },
    target: {
      autoCreatePr: input.autoCreatePr !== false,
    },
  }
  if (input.model?.trim()) body.model = input.model.trim()
  if (input.name?.trim()) body.name = input.name.trim().slice(0, 100)

  const res = await cloudRequest('/agents', { method: 'POST', body }, seams)
  if (!res.ok) {
    return { ok: false, parked: res.parked, reason: res.reason, error: res.error }
  }
  if (res.value.status < 200 || res.value.status >= 300) {
    const classified = classifyApiFailure(
      res.value.status,
      errorMessage(res.value.json, res.value.text || 'launch failed'),
    )
    return {
      ok: false,
      parked: classified.parked,
      reason: classified.reason,
      error: classified.note,
    }
  }
  const snapshot = parseCloudAgentPayload(res.value.json)
  if (!snapshot) {
    return { ok: false, error: 'Need: cloud agent launch returned an unexpected payload.' }
  }
  return { ok: true, value: snapshot }
}

export async function pollCloudAgent(
  id: string,
  seams?: CloudOriginSeams,
): Promise<CloudResult<CloudAgentSnapshot>> {
  const trimmed = id.trim()
  if (!trimmed) return { ok: false, error: 'Need: cloud agent id is empty.' }
  const res = await cloudRequest(`/agents/${encodeURIComponent(trimmed)}`, { method: 'GET' }, seams)
  if (!res.ok) {
    return { ok: false, parked: res.parked, reason: res.reason, error: res.error }
  }
  if (res.value.status < 200 || res.value.status >= 300) {
    const classified = classifyApiFailure(
      res.value.status,
      errorMessage(res.value.json, res.value.text || 'poll failed'),
    )
    return {
      ok: false,
      parked: classified.parked,
      reason: classified.reason,
      error: classified.note,
    }
  }
  const snapshot = parseCloudAgentPayload(res.value.json)
  if (!snapshot) {
    return { ok: false, error: 'Need: cloud agent status returned an unexpected payload.' }
  }
  return { ok: true, value: snapshot }
}

/**
 * Read an Origin forge remote from a checkout when present.
 * Returns null for GitHub remotes — never guesses Origin from GitHub.
 */
export function readExplicitOriginRemote(
  checkoutPath: string,
  readRemote: (path: string) => string | null = defaultReadGitRemote,
): string | null {
  const trimmed = checkoutPath.trim()
  if (!trimmed) return null
  const remote = readRemote(trimmed)
  if (!remote) return null
  return parseOriginRemote(remote) ? remote : null
}

function defaultReadGitRemote(path: string): string | null {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: path,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
  })
  if ((result.status ?? 1) !== 0) return null
  const url = (result.stdout ?? '').trim()
  return url || null
}

export function cloudAgentStatusLabel(snapshot: CloudAgentSnapshot): string {
  const bits = [snapshot.status]
  if (snapshot.prUrl) bits.push('PR ready')
  else if (snapshot.branchName) bits.push(snapshot.branchName)
  return bits.join(' · ')
}
