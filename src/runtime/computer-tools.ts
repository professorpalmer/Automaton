import type { AgentId, AgentKit } from '../domain'
import { looksLikeBoxShell, nextId, parseDeskUrl } from '../domain'
import { humanDrivingSpoken, refuseWhileHumanDriving } from './driving'
import { displayLeases, type DisplayLeases } from './lease'

export type ComputerToolName =
  | 'box_shell'
  | 'box_read'
  | 'box_screenshot'
  | 'box_browser'
  | 'box_computer'
  | 'operator_help'
  | 'copy_in'
  | 'copy_out'
  | 'host_read'
  | 'host_shell'
  | 'host_attach'

export type ComputerToolCall = {
  name: ComputerToolName
  args: Record<string, unknown>
}

export type ComputerToolResult = {
  ok: boolean
  spoken: string
  screenshotPath?: string
  needsApproval?: boolean
  refused?: boolean
  operatorHelp?: boolean
  action?: string
}

export type ActionDecision = 'permit' | 'refuse'

/** Computer act recorded before the seam runs. Out of chat. Never holds typed text or file bytes. */
export type ActionEvent = {
  id: string
  ownerAgentId: AgentId
  tool: string
  intent: string
  decision: ActionDecision
  reason: string
  path?: string
  secretChars?: number
  at: number
}

export const KEEP_SCREENSHOTS = 3
export const HOST_APPROVAL_PROMPT = 'Run this on your Mac?'

const COORDINATOR_TOOLS: ComputerToolName[] = [
  'operator_help',
  'host_read',
  'host_shell',
  'host_attach',
  'copy_in',
  'copy_out',
  'box_screenshot',
]

const WORKER_TOOLS: ComputerToolName[] = [
  'box_shell',
  'box_read',
  'box_screenshot',
  'box_browser',
  'box_computer',
  'operator_help',
  'copy_in',
  'copy_out',
]

export function computerWorkerAllowed(kit: AgentKit, ping = false): boolean {
  if (ping) return false
  return kit === 'code' || kit === 'lookup' || kit === 'coordinator'
}

export function toolsForComputerRole(role: 'coordinator' | 'worker', kit: AgentKit): ComputerToolName[] {
  if (kit === 'blank') return []
  if (role === 'coordinator') return [...COORDINATOR_TOOLS]
  return [...WORKER_TOOLS]
}

export function staffMayPixelClick(role: 'coordinator' | 'worker'): boolean {
  return role !== 'coordinator'
}

export function routeComputerSurface(text: string): 'box' | 'host' {
  const lower = text.toLowerCase()
  if (/\bon my mac\b/.test(lower)) return 'host'
  if (/\bin this repo on disk\b/.test(lower)) return 'host'
  if (/\bon (?:this|the) mac\b/.test(lower)) return 'host'
  if (/\/users\/[^\s]+/i.test(text)) return 'host'
  if (/~\//.test(text) && /\bmac\b/.test(lower)) return 'host'
  return 'box'
}

export function captchaOrigin(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  if (lower.includes('recaptcha')) return true
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = parsed.host.toLowerCase()
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase()
    if (path.includes('/sorry') || path.includes('recaptcha')) return true
    if (host === 'google.com' || host.startsWith('www.google.') || host.startsWith('google.')) return true
    if (host.endsWith('.google.com') || host.includes('.google.')) return true
    if (host.includes('google') && (path.includes('search?q=') || parsed.searchParams.has('q'))) return true
    return false
  } catch {
    return /(?:^|[/.])google\.|recaptcha|\/sorry/i.test(lower)
  }
}

export function sorryPage(url: string, title = ''): boolean {
  const hay = `${url} ${title}`.toLowerCase()
  if (hay.includes('unusual traffic')) return true
  if (hay.includes("i'm not a robot") || hay.includes('im not a robot')) return true
  if (hay.includes('recaptcha')) return true
  return /\/sorry(?:\/|\?|$|#)/.test(hay)
}

export function continueFromSorry(url: string, fallback: string): string {
  try {
    const parsed = new URL(url)
    const cont = parsed.searchParams.get('continue')
    if (cont && /^https?:\/\//i.test(cont)) return cont
  } catch {
    /* ignore */
  }
  return fallback
}

export function looksLikePasswordSite(text: string): boolean {
  const lower = text.toLowerCase()
  if (/\b(password|sign in|signin|log[\s-]?in|sso|2fa|captcha|otp)\b/.test(lower)) return true
  const url = parseDeskUrl(text) ?? (/^https?:\/\//i.test(text.trim()) ? text.trim() : null)
  if (!url) return false
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    const host = parsed.host.toLowerCase()
    if (host.includes('github') && /login/.test(`${parsed.pathname} ${lower}`)) return true
    if (host.includes('google') && /\b(login|sign in|account)\b/.test(lower)) return true
    return /\/login\b/i.test(parsed.pathname)
  } catch {
    return false
  }
}

export function needsOperatorHandoff(url: string, text = ''): boolean {
  if (looksLikePasswordSite(text) || looksLikePasswordSite(url)) return true
  if (captchaOrigin(url)) return true
  try {
    const host = new URL(url).host.toLowerCase()
    if (host.includes('github') && /login/.test(url)) return true
  } catch {
    return false
  }
  return false
}

export function looksLikeComputerUse(text: string): boolean {
  if (looksLikeBoxShell(text)) return false
  const lower = text.toLowerCase()
  if (/\b(click|type into|scroll|screenshot the|on the desktop|pixel-click|pixel click)\b/.test(lower)) {
    return true
  }
  const url = parseDeskUrl(text)
  return Boolean(url) && !needsOperatorHandoff(url ?? '', text)
}

export function preferredToolForAsk(text: string): ComputerToolName {
  const surface = routeComputerSurface(text)
  const lower = text.toLowerCase()
  if (surface === 'host') {
    if (/\b(run|exec|shell|command|install)\b/.test(lower) && !/\bcomputer\b/.test(lower)) return 'host_shell'
    return 'host_read'
  }
  if (looksLikePasswordSite(text) || (parseDeskUrl(text) && needsOperatorHandoff(parseDeskUrl(text) ?? '', text))) {
    return 'operator_help'
  }
  if (parseDeskUrl(text) || /\b(open|browse|navigate|visit)\b/.test(lower)) return 'box_browser'
  if (/\b(click|type|scroll|screenshot|desktop|pixel)\b/.test(lower)) return 'box_computer'
  if (looksLikeBoxShell(text)) return 'box_shell'
  return 'box_shell'
}

export function boxShellLooksLikeGui(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    /\bxdotool\b/.test(lower) ||
    /\bxwd\b/.test(lower) ||
    /\bmousemove\b/.test(lower) ||
    /\bkey --window\b/.test(lower) ||
    (/\bclick\b/.test(lower) && /\b(xdotool|mousemove|desktop)\b/.test(lower))
  )
}

export function stableComputerPrefix(input: { agentName: string; display: number; goal?: string }): string {
  return [
    `You drive ${input.agentName}'s screen on the Automaton computer (DISPLAY :${input.display}).`,
    'Use box_browser for the web. Use box_computer for pixels. Use box_shell for install and PATH, never for clicks.',
    'Never type passwords. Call operator_help and wait.',
    'Do not declare the Goal complete. Return what you did.',
  ].join(' ')
}

export function prefixHasTimestamp(text: string): boolean {
  return /\b\d{4}-\d{2}-\d{2}T|\bDate\.now\b|\bunix timestamp\b/i.test(text)
}

export function prefixHasVolatile(text: string): boolean {
  return prefixHasTimestamp(text) || /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)
}

export function trimScreenshots<T extends { screenshotPath?: string }>(
  items: T[],
  keep = KEEP_SCREENSHOTS,
): T[] {
  const shots: number[] = []
  items.forEach((item, index) => {
    if (item.screenshotPath) shots.push(index)
  })
  const drop = new Set(shots.slice(0, Math.max(0, shots.length - keep)))
  return items.map((item, index) => (drop.has(index) ? { ...item, screenshotPath: undefined } : item))
}

export type ComputerToolSeams = {
  boxExec?: (argv: string[], env?: Record<string, string>) => { status: number; text: string }
  browse?: (agentId: string, url: string) => string | null | Promise<string | null>
  click?: (agentId: string, point: { x: number; y: number }) => boolean
  key?: (agentId: string, stroke: string) => boolean
  screenshot?: (agentId: string) => string | null | Promise<string | null>
  readBox?: (path: string) => string | null
  copyIn?: (from: string, to: string) => boolean
  copyOut?: (from: string, to: string) => boolean
  hostAllowed?: boolean
  leases?: DisplayLeases
  refuseDriving?: typeof refuseWhileHumanDriving
  recordAction?: (event: ActionEvent) => void
}

export type ComputerToolContext = {
  agentId: string
  display: number
  holderId: string
  role: 'coordinator' | 'worker'
  kit: AgentKit
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asPoint(args: Record<string, unknown>): { x: number; y: number } | null {
  const x = typeof args.x === 'number' ? args.x : Number(args.x)
  const y = typeof args.y === 'number' ? args.y : Number(args.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function hostDenied(): ComputerToolResult {
  return {
    ok: false,
    spoken: 'Not running that on your Mac.',
    needsApproval: true,
    refused: true,
  }
}

function hostCard(action = ''): ComputerToolResult {
  return {
    ok: false,
    spoken: HOST_APPROVAL_PROMPT,
    needsApproval: true,
    action: action || undefined,
  }
}

function actionIntent(call: ComputerToolCall): string {
  if (call.name === 'box_computer') {
    if (asPoint(call.args)) return 'click'
    if (asString(call.args.key) || asString(call.args.text)) return 'type'
    return 'pixel'
  }
  if (call.name === 'box_shell') return 'shell'
  if (call.name === 'box_read') return 'read'
  if (call.name === 'box_browser') return 'browse'
  if (call.name === 'copy_out') return 'copy_out'
  if (call.name === 'copy_in') return 'copy_in'
  if (call.name === 'box_screenshot') return 'screenshot'
  if (call.name === 'operator_help') return 'operator_help'
  if (call.name === 'host_read') return 'host_read'
  if (call.name === 'host_shell') return 'host_shell'
  if (call.name === 'host_attach') return 'host_attach'
  return call.name
}

function actionPath(call: ComputerToolCall): string | undefined {
  const path =
    asString(call.args.path) ||
    asString(call.args.from) ||
    asString(call.args.url) ||
    parseDeskUrl(asString(call.args.query)) ||
    ''
  return path || undefined
}

function actionSecretChars(call: ComputerToolCall): number | undefined {
  if (call.name !== 'box_computer') return undefined
  const text = asString(call.args.text) || asString(call.args.key)
  return text ? text.length : undefined
}

function recordComputerAction(
  seams: ComputerToolSeams,
  ctx: ComputerToolContext,
  call: ComputerToolCall,
  decision: ActionDecision,
  reason: string,
): void {
  seams.recordAction?.({
    id: nextId('action'),
    ownerAgentId: ctx.agentId,
    tool: call.name,
    intent: actionIntent(call),
    decision,
    reason,
    path: actionPath(call),
    secretChars: actionSecretChars(call),
    at: Date.now(),
  })
}

function refusedTool(
  seams: ComputerToolSeams,
  ctx: ComputerToolContext,
  call: ComputerToolCall,
  spoken: string,
  reason: string,
): ComputerToolResult {
  recordComputerAction(seams, ctx, call, 'refuse', reason)
  return { ok: false, spoken, refused: true }
}

export async function executeComputerTool(
  call: ComputerToolCall,
  ctx: ComputerToolContext,
  seams: ComputerToolSeams = {},
): Promise<ComputerToolResult> {
  if (ctx.kit === 'blank') {
    return refusedTool(seams, ctx, call, 'No computer worker until a kit is set.', 'blank_kit')
  }
  if (call.name === 'box_computer' || call.name === 'box_browser') {
    if (!staffMayPixelClick(ctx.role)) {
      return refusedTool(seams, ctx, call, 'Staff does not pixel-click.', 'staff_pixel')
    }
    const refuse = (seams.refuseDriving ?? refuseWhileHumanDriving)(call.name, ctx.display)
    if (refuse.refuse) {
      return refusedTool(seams, ctx, call, humanDrivingSpoken(), 'human_driving')
    }
    const leases = seams.leases ?? displayLeases()
    const hold = leases.acquire(ctx.display, ctx.holderId)
    if (!hold.ok) {
      return refusedTool(seams, ctx, call, 'That screen is busy.', 'busy_screen')
    }
    leases.renew(ctx.display, ctx.holderId)
  }

  if (call.name === 'host_read' || call.name === 'host_shell' || call.name === 'host_attach') {
    const action =
      asString(call.args.command) || asString(call.args.cmd) || asString(call.args.path) || call.name
    if (seams.hostAllowed === false) {
      recordComputerAction(seams, ctx, call, 'refuse', 'host_denied')
      return hostDenied()
    }
    if (seams.hostAllowed === true) {
      recordComputerAction(seams, ctx, call, 'permit', 'host_allowed')
      return { ok: true, spoken: 'Running on your Mac.' }
    }
    recordComputerAction(seams, ctx, call, 'refuse', 'host_card')
    return hostCard(action)
  }

  if (call.name === 'box_shell') {
    const command = asString(call.args.command) || asString(call.args.cmd) || asString(call.args.argv)
    if (boxShellLooksLikeGui(command)) {
      return refusedTool(
        seams,
        ctx,
        call,
        'box_shell cannot click. Use box_computer or box_browser.',
        'gui_shell',
      )
    }
    if (!seams.boxExec) {
      return refusedTool(seams, ctx, call, 'The computer is not running.', 'computer_down')
    }
    recordComputerAction(seams, ctx, call, 'permit', 'shell')
    const result = seams.boxExec(['sh', '-c', command || 'true'], { HOME: '/home/box' })
    if (result.status === 0) return { ok: true, spoken: result.text.trim() || 'Done on the computer.' }
    return { ok: false, spoken: result.text.trim() || 'The computer command failed.' }
  }

  if (call.name === 'box_read') {
    const path = asString(call.args.path)
    if (!path) return refusedTool(seams, ctx, call, 'Need a path on the computer.', 'missing_path')
    if (seams.readBox) {
      recordComputerAction(seams, ctx, call, 'permit', 'read')
      const text = seams.readBox(path)
      if (text == null) return { ok: false, spoken: `Could not read ${path} on the computer.` }
      return { ok: true, spoken: text }
    }
    if (!seams.boxExec) {
      return refusedTool(seams, ctx, call, 'The computer is not running.', 'computer_down')
    }
    recordComputerAction(seams, ctx, call, 'permit', 'read')
    const result = seams.boxExec(['cat', path])
    if (result.status !== 0) return { ok: false, spoken: `Could not read ${path} on the computer.` }
    return { ok: true, spoken: result.text }
  }

  if (call.name === 'box_screenshot') {
    recordComputerAction(seams, ctx, call, 'permit', 'screenshot')
    const path = (await seams.screenshot?.(ctx.agentId)) ?? null
    if (!path) return { ok: false, spoken: 'Could not capture the screen.' }
    return { ok: true, spoken: 'Captured the screen.', screenshotPath: path }
  }

  if (call.name === 'box_browser') {
    const url = asString(call.args.url) || parseDeskUrl(asString(call.args.query)) || ''
    if (!url) return refusedTool(seams, ctx, call, 'Need a URL.', 'missing_path')
    if (!seams.browse) {
      return refusedTool(seams, ctx, call, 'The computer browser is not available.', 'computer_down')
    }
    recordComputerAction(seams, ctx, call, 'permit', 'browse')
    const shot = await seams.browse(ctx.agentId, url)
    return {
      ok: true,
      spoken: `Opened ${url}.`,
      screenshotPath: shot ?? undefined,
    }
  }

  if (call.name === 'box_computer') {
    const point = asPoint(call.args)
    const key = asString(call.args.key) || asString(call.args.text)
    if (point && seams.click) {
      recordComputerAction(seams, ctx, call, 'permit', 'click')
      const ok = seams.click(ctx.agentId, point)
      return ok
        ? { ok: true, spoken: `Clicked ${point.x},${point.y}.` }
        : { ok: false, spoken: 'Click failed.' }
    }
    if (key && seams.key) {
      recordComputerAction(seams, ctx, call, 'permit', 'type')
      const ok = seams.key(ctx.agentId, key)
      return ok ? { ok: true, spoken: 'Typed on the screen.' } : { ok: false, spoken: 'Type failed.' }
    }
    return refusedTool(seams, ctx, call, 'Need a click point or a key.', 'missing_input')
  }

  if (call.name === 'operator_help') {
    const instruction = asString(call.args.instruction) || 'Sign in if this page asks.'
    recordComputerAction(seams, ctx, call, 'permit', 'operator_help')
    return { ok: true, spoken: instruction, operatorHelp: true }
  }

  if (call.name === 'copy_in') {
    const from = asString(call.args.from) || asString(call.args.path)
    const to = asString(call.args.to) || '/home/box/host/inbox'
    if (!from) return refusedTool(seams, ctx, call, 'Need a Mac path to copy in.', 'missing_path')
    recordComputerAction(seams, ctx, call, 'permit', 'copy_in')
    if (seams.copyIn && !seams.copyIn(from, to)) return { ok: false, spoken: 'Could not copy onto the computer.' }
    return { ok: true, spoken: 'Copied onto the computer.' }
  }

  if (call.name === 'copy_out') {
    const from = asString(call.args.from) || asString(call.args.path)
    const to = asString(call.args.to)
    if (!from) return refusedTool(seams, ctx, call, 'Need a computer path to copy out.', 'missing_path')
    recordComputerAction(seams, ctx, call, 'permit', 'copy_out')
    if (seams.copyOut && !seams.copyOut(from, to)) return { ok: false, spoken: 'Could not copy off the computer.' }
    return { ok: true, spoken: 'Copied off the computer.' }
  }

  return refusedTool(seams, ctx, call, 'Unknown computer tool.', 'unknown_tool')
}

export async function executeComputerBatch(
  actions: ComputerToolCall[],
  ctx: ComputerToolContext,
  seams: ComputerToolSeams = {},
): Promise<{ results: ComputerToolResult[]; halted: boolean }> {
  const results: ComputerToolResult[] = []
  for (const action of actions) {
    const result = await executeComputerTool(action, ctx, seams)
    results.push(result)
    if (!result.ok) return { results, halted: true }
  }
  return { results, halted: false }
}

export function idleComputer(seams: { leases?: DisplayLeases; sleep?: () => boolean } = {}): {
  slept: boolean
  retryAt?: number
} {
  const leases = seams.leases ?? displayLeases()
  const idle = leases.idleSuspend()
  if (!idle.ok) return { slept: false, retryAt: idle.retryAt }
  const slept = seams.sleep ? seams.sleep() : true
  if (!slept) return { slept: false, retryAt: Date.now() + 30_000 }
  return { slept: true }
}
