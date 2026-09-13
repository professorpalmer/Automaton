import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { ChannelReplyRouting } from '../domain'

export type { ChannelReplyRouting }
import { automatonHome } from './keys'

export type ChannelPlatform = 'slack'

export type Channel = {
  id: string
  platform: ChannelPlatform
  name: string
  connected: boolean
  needsAuth: boolean
  lastError?: string
  meta?: Record<string, unknown>
}

export type SlackSecrets = {
  botToken: string
  appToken?: string
}

export type ChannelInbound = {
  /** Our Channel.id (connection), usually `slack`. */
  connectionId: string
  platform: 'slack'
  /** Slack conversation id (C… / D…) for chat.postMessage. */
  slackChannel: string
  user: string
  text: string
  isDm: boolean
  roomName?: string
  threadTs?: string
  expectReply: boolean
}

export type ChannelsSeams = {
  fetch?: typeof fetch
  now?: () => number
}

const SLACK_ID = 'slack'
const SLACK_API = 'https://slack.com/api'

export function channelsPath(home = automatonHome()): string {
  return join(home, 'channels.json')
}

export function slackSecretsPath(home = automatonHome()): string {
  return join(home, 'secrets', 'slack.json')
}

export function slackInboxDir(home = automatonHome()): string {
  return join(home, 'inbox', 'slack')
}

function defaultSlack(): Channel {
  return {
    id: SLACK_ID,
    platform: 'slack',
    name: 'Slack',
    connected: false,
    needsAuth: true,
  }
}

function asError(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeChannel(row: Record<string, unknown>): Channel | null {
  const platform = row.platform === 'slack' ? 'slack' : null
  if (!platform) return null
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : SLACK_ID
  return {
    id,
    platform,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Slack',
    connected: row.connected === true,
    needsAuth: row.needsAuth !== false,
    lastError: asError(row.lastError),
    meta:
      row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : undefined,
  }
}

/** Public view — never includes tokens. */
export function listChannels(home = automatonHome()): Channel[] {
  const path = channelsPath(home)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((row) => row && typeof row === 'object')
      .map((row) => normalizeChannel(row as Record<string, unknown>))
      .filter((row): row is Channel => row != null)
  } catch {
    return []
  }
}

function writeChannels(rows: Channel[], home = automatonHome()): void {
  const path = channelsPath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
}

function readSlackSecrets(home = automatonHome()): SlackSecrets | null {
  const path = slackSecretsPath(home)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const botToken = typeof raw.botToken === 'string' ? raw.botToken.trim() : ''
    if (!botToken) return null
    const appToken = typeof raw.appToken === 'string' ? raw.appToken.trim() : ''
    return appToken ? { botToken, appToken } : { botToken }
  } catch {
    return null
  }
}

function writeSlackSecrets(secrets: SlackSecrets, home = automatonHome()): void {
  const path = slackSecretsPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const body: Record<string, string> = { botToken: secrets.botToken }
  if (secrets.appToken) body.appToken = secrets.appToken
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
}

function clearSlackSecrets(home = automatonHome()): void {
  const path = slackSecretsPath(home)
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch {
    /* best-effort */
  }
}

/** True when a bot token is on disk. Callers must not log the token. */
export function hasSlackGrant(home = automatonHome()): boolean {
  return Boolean(readSlackSecrets(home)?.botToken)
}

export function slackStatus(home = automatonHome()): Channel {
  const row = listChannels(home).find((c) => c.platform === 'slack' && c.id === SLACK_ID)
  const granted = hasSlackGrant(home)
  if (row) {
    if (!granted) return { ...row, connected: false, needsAuth: true }
    return { ...row, needsAuth: false }
  }
  if (granted) {
    return { ...defaultSlack(), connected: true, needsAuth: false }
  }
  return defaultSlack()
}

/**
 * Persist Slack bot token under ~/.automaton/secrets/slack.json (chmod 600).
 * Never log tokens. Leaves hooks for more platforms via Channel.platform.
 */
export function connectSlack(
  input: { botToken: string; appToken?: string; name?: string },
  home = automatonHome(),
): Channel {
  const botToken = input.botToken.trim()
  if (!botToken) {
    const row: Channel = {
      ...defaultSlack(),
      connected: false,
      needsAuth: true,
      lastError: 'Need a Slack bot token.',
    }
    upsertChannel(row, home)
    return row
  }
  const secrets: SlackSecrets = { botToken }
  const appToken = input.appToken?.trim()
  if (appToken) secrets.appToken = appToken
  writeSlackSecrets(secrets, home)
  const row: Channel = {
    id: SLACK_ID,
    platform: 'slack',
    name: input.name?.trim() || 'Slack',
    connected: true,
    needsAuth: false,
    lastError: undefined,
  }
  upsertChannel(row, home)
  return row
}

function upsertChannel(row: Channel, home = automatonHome()): void {
  const rows = listChannels(home).filter((c) => !(c.platform === row.platform && c.id === row.id))
  rows.push(row)
  writeChannels(rows, home)
}

export function disconnectChannel(id: string, home = automatonHome()): Channel | null {
  const trimmed = id.trim()
  if (!trimmed) return null
  const rows = listChannels(home)
  const hit = rows.find((c) => c.id === trimmed)
  if (!hit) return null
  if (hit.platform === 'slack') clearSlackSecrets(home)
  const next: Channel = {
    ...hit,
    connected: false,
    needsAuth: true,
    lastError: undefined,
  }
  writeChannels(
    rows.map((c) => (c.id === trimmed ? next : c)),
    home,
  )
  return next
}

export type SendSlackResult =
  | { ok: true; ts?: string }
  | { ok: false; error: string }

/**
 * Post via Slack Web API chat.postMessage. Fail closed when disconnected /
 * missing grant / missing destination. Never invents delivery.
 */
export async function sendSlackMessage(
  input: { channelId: string; text: string; threadTs?: string; seams?: ChannelsSeams },
  home = automatonHome(),
): Promise<SendSlackResult> {
  const slackChannel = input.channelId.trim()
  const text = input.text.trim()
  if (!slackChannel) return { ok: false, error: 'Need a Slack channel.' }
  if (!text) return { ok: false, error: 'Need message text.' }

  const status = slackStatus(home)
  if (!status.connected || status.needsAuth) {
    return { ok: false, error: 'Need Slack auth.' }
  }
  const secrets = readSlackSecrets(home)
  if (!secrets?.botToken) {
    markSlackNeed(home, 'Need Slack auth.')
    return { ok: false, error: 'Need Slack auth.' }
  }

  const fetchImpl = input.seams?.fetch ?? fetch
  const body: Record<string, string> = { channel: slackChannel, text }
  if (input.threadTs?.trim()) body.thread_ts = input.threadTs.trim()

  try {
    const res = await fetchImpl(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !json || json.ok !== true) {
      const err =
        (typeof json?.error === 'string' && json.error) ||
        (!res.ok ? `HTTP ${res.status}` : 'Slack post failed')
      if (isSlackAuthError(err)) {
        markSlackNeed(home, err)
      } else {
        markSlackLastError(home, err)
      }
      return { ok: false, error: err }
    }
    clearSlackError(home)
    const ts = typeof json.ts === 'string' ? json.ts : undefined
    return { ok: true, ts }
  } catch {
    markSlackLastError(home, 'Slack unreachable.')
    return { ok: false, error: 'Slack unreachable.' }
  }
}

function isSlackAuthError(err: string): boolean {
  return /invalid_auth|not_authed|token_revoked|account_inactive|missing_scope/i.test(err)
}

function markSlackNeed(home: string, error: string): void {
  const row = listChannels(home).find((c) => c.id === SLACK_ID) ?? defaultSlack()
  upsertChannel(
    {
      ...row,
      id: SLACK_ID,
      platform: 'slack',
      connected: false,
      needsAuth: true,
      lastError: error,
    },
    home,
  )
}

function markSlackLastError(home: string, error: string): void {
  const row = listChannels(home).find((c) => c.id === SLACK_ID) ?? slackStatus(home)
  upsertChannel(
    {
      ...row,
      id: SLACK_ID,
      platform: 'slack',
      lastError: error,
    },
    home,
  )
}

function clearSlackError(home: string): void {
  const row = listChannels(home).find((c) => c.id === SLACK_ID)
  if (!row || !row.lastError) return
  upsertChannel({ ...row, id: SLACK_ID, platform: 'slack', lastError: undefined }, home)
}

/**
 * Normalize a Slack mention/DM into ChannelInbound for the session.
 * expectReply defaults true for MVP mention/DM replies.
 */
export function ingestSlackInbound(input: {
  channelId: string
  user: string
  text: string
  isDm: boolean
  threadTs?: string
  roomName?: string
  expectReply?: boolean
  connectionId?: string
}): ChannelInbound {
  const slackChannel = input.channelId.trim()
  const user = input.user.trim() || 'someone'
  const text = input.text.trim()
  return {
    connectionId: input.connectionId?.trim() || SLACK_ID,
    platform: 'slack',
    slackChannel,
    user,
    text,
    isDm: input.isDm === true,
    roomName: input.roomName?.trim() || undefined,
    threadTs: input.threadTs?.trim() || undefined,
    expectReply: input.expectReply !== false,
  }
}

/** User-facing line for the mouth — room vs DM context, no private staff chatter. */
export function formatChannelInboundText(inbound: ChannelInbound): string {
  const where = inbound.isDm ? 'DM' : inbound.roomName ? `#${inbound.roomName}` : 'channel'
  return `[Slack ${where} · ${inbound.user}]\n${inbound.text}`
}

export function channelReplyFromInbound(inbound: ChannelInbound): ChannelReplyRouting {
  return {
    platform: 'slack',
    connectionId: inbound.connectionId,
    slackChannel: inbound.slackChannel,
    threadTs: inbound.threadTs,
    expectReply: inbound.expectReply,
  }
}

export type SlackInboxEvent = {
  channelId: string
  user: string
  text: string
  isDm?: boolean
  threadTs?: string
  roomName?: string
  expectReply?: boolean
}

/**
 * Drain ~/.automaton/inbox/slack/*.json (MVP inbound without Socket Mode in-app).
 * Processed files move to processed/ or are deleted on success.
 */
export function drainSlackInbox(
  home = automatonHome(),
  seams: { onEvent?: (event: SlackInboxEvent) => void } = {},
): { drained: number; errors: string[] } {
  const dir = slackInboxDir(home)
  if (!existsSync(dir)) return { drained: 0, errors: [] }
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.'))
  } catch {
    return { drained: 0, errors: ['Need Slack inbox.'] }
  }
  const processed = join(dir, 'processed')
  mkdirSync(processed, { recursive: true })
  let drained = 0
  const errors: string[] = []
  for (const name of names.sort()) {
    const path = join(dir, name)
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : ''
      const user = typeof raw.user === 'string' ? raw.user.trim() : ''
      const text = typeof raw.text === 'string' ? raw.text.trim() : ''
      if (!channelId || !text) {
        errors.push(`${name}: Need channelId and text.`)
        continue
      }
      const event: SlackInboxEvent = {
        channelId,
        user: user || 'someone',
        text,
        isDm: raw.isDm === true,
        threadTs: typeof raw.threadTs === 'string' ? raw.threadTs : undefined,
        roomName: typeof raw.roomName === 'string' ? raw.roomName : undefined,
        expectReply: raw.expectReply !== false,
      }
      seams.onEvent?.(event)
      const dest = join(processed, name)
      try {
        renameSync(path, dest)
      } catch {
        unlinkSync(path)
      }
      drained += 1
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : 'parse failed'}`)
    }
  }
  return { drained, errors }
}

export function channelStatusLabel(row: Channel): string {
  if (row.lastError) return row.needsAuth ? 'Need auth' : row.lastError
  if (row.connected) return 'Connected'
  if (row.needsAuth) return 'Need auth'
  return 'Disconnected'
}
