import type { AgentKit } from '../domain'
import { looksLikeBoxShell, parseDeskUrl } from '../domain'
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
  try {
    const host = new URL(url).host.toLowerCase()
    if (host.includes('google')) return true
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

export function stableComputerPrefix(input: { agentName: string; display: number; goal: string }): string {
  return [
    `You drive ${input.agentName}'s screen on the Automaton computer (DISPLAY :${input.display}).`,
    'Use box_browser for the web. Use box_computer for pixels. Use box_shell for install and PATH, never for clicks.',
    'Never type passwords. Call operator_help and wait.',
    'Do not declare the Goal complete. Return what you did.',
    `Task: ${input.goal}`,
  ].join(' ')
}

export function prefixHasTimestamp(text: string): boolean {
  return /\b\d{4}-\d{2}-\d{2}T|\bDate\.now\b|\bunix timestamp\b/i.test(text)
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
  screenshot?: (agentId: string) => string | null
  readBox?: (path: string) => string | null
  copyIn?: (from: string, to: string) => boolean
  copyOut?: (from: string, to: string) => boolean
  hostAllowed?: boolean
  leases?: DisplayLeases
  refuseDriving?: typeof refuseWhileHumanDriving
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

function hostCard(): ComputerToolResult {
  return {
    ok: false,
    spoken: HOST_APPROVAL_PROMPT,
    needsApproval: true,
  }
}

export async function executeComputerTool(
  call: ComputerToolCall,
  ctx: ComputerToolContext,
  seams: ComputerToolSeams = {},
): Promise<ComputerToolResult> {
  if (ctx.kit === 'blank') {
    return { ok: false, spoken: 'No computer worker until a kit is set.', refused: true }
  }
  if (call.name === 'box_computer' || call.name === 'box_browser') {
    if (!staffMayPixelClick(ctx.role)) {
      return { ok: false, spoken: 'Staff does not pixel-click.', refused: true }
    }
    const refuse = (seams.refuseDriving ?? refuseWhileHumanDriving)(call.name, ctx.display)
    if (refuse.refuse) {
      return { ok: false, spoken: humanDrivingSpoken(), refused: true }
    }
    const leases = seams.leases ?? displayLeases()
    const hold = leases.acquire(ctx.display, ctx.holderId)
    if (!hold.ok) {
      return { ok: false, spoken: 'That screen is busy.', refused: true }
    }
    leases.renew(ctx.display, ctx.holderId)
  }

  if (call.name === 'host_read' || call.name === 'host_shell' || call.name === 'host_attach') {
    if (seams.hostAllowed === false) return hostDenied()
    if (seams.hostAllowed === true) return { ok: true, spoken: 'Running on your Mac.' }
    return hostCard()
  }

  if (call.name === 'box_shell') {
    const command = asString(call.args.command) || asString(call.args.cmd) || asString(call.args.argv)
    if (boxShellLooksLikeGui(command)) {
      return { ok: false, spoken: 'box_shell cannot click. Use box_computer or box_browser.', refused: true }
    }
    if (!seams.boxExec) {
      return { ok: false, spoken: 'The computer is not running.' }
    }
    const result = seams.boxExec(['sh', '-c', command || 'true'], { HOME: '/home/box' })
    if (result.status === 0) return { ok: true, spoken: result.text.trim() || 'Done on the computer.' }
    return { ok: false, spoken: result.text.trim() || 'The computer command failed.' }
  }

  if (call.name === 'box_read') {
    const path = asString(call.args.path)
    if (!path) return { ok: false, spoken: 'Need a path on the computer.' }
    if (seams.readBox) {
      const text = seams.readBox(path)
      if (text == null) return { ok: false, spoken: `Could not read ${path} on the computer.` }
      return { ok: true, spoken: text }
    }
    if (!seams.boxExec) return { ok: false, spoken: 'The computer is not running.' }
    const result = seams.boxExec(['cat', path])
    if (result.status !== 0) return { ok: false, spoken: `Could not read ${path} on the computer.` }
    return { ok: true, spoken: result.text }
  }

  if (call.name === 'box_screenshot') {
    const path = seams.screenshot?.(ctx.agentId) ?? null
    if (!path) return { ok: false, spoken: 'Could not capture the screen.' }
    return { ok: true, spoken: 'Captured the screen.', screenshotPath: path }
  }

  if (call.name === 'box_browser') {
    const url = asString(call.args.url) || parseDeskUrl(asString(call.args.query)) || ''
    if (!url) return { ok: false, spoken: 'Need a URL.' }
    if (!seams.browse) return { ok: false, spoken: 'The computer browser is not available.' }
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
      const ok = seams.click(ctx.agentId, point)
      return ok
        ? { ok: true, spoken: `Clicked ${point.x},${point.y}.` }
        : { ok: false, spoken: 'Click failed.' }
    }
    if (key && seams.key) {
      const ok = seams.key(ctx.agentId, key)
      return ok ? { ok: true, spoken: 'Typed on the screen.' } : { ok: false, spoken: 'Type failed.' }
    }
    return { ok: false, spoken: 'Need a click point or a key.' }
  }

  if (call.name === 'operator_help') {
    const instruction = asString(call.args.instruction) || 'Sign in if this page asks.'
    return { ok: true, spoken: instruction, operatorHelp: true }
  }

  if (call.name === 'copy_in') {
    const from = asString(call.args.from) || asString(call.args.path)
    const to = asString(call.args.to) || '/home/box/host/inbox'
    if (!from) return { ok: false, spoken: 'Need a Mac path to copy in.' }
    if (seams.copyIn && !seams.copyIn(from, to)) return { ok: false, spoken: 'Could not copy onto the computer.' }
    return { ok: true, spoken: 'Copied onto the computer.' }
  }

  if (call.name === 'copy_out') {
    const from = asString(call.args.from) || asString(call.args.path)
    const to = asString(call.args.to)
    if (!from) return { ok: false, spoken: 'Need a computer path to copy out.' }
    if (seams.copyOut && !seams.copyOut(from, to)) return { ok: false, spoken: 'Could not copy off the computer.' }
    return { ok: true, spoken: 'Copied off the computer.' }
  }

  return { ok: false, spoken: 'Unknown computer tool.' }
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
