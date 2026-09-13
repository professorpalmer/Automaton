/** Locate / deep-link the stock Puppetmaster dashboard. Never a second server. */

import { spawnSync } from 'node:child_process'
import { PRODUCT_ROOT, pmEnv, resolvePm } from './pm'
import { runningTests } from './test-env'

export const DEFAULT_DASHBOARD_HOST = '127.0.0.1'
export const DEFAULT_DASHBOARD_PORT = 8787
const JOB_ID_MAX = 128
const LOCATE_FAIL = 'Need Puppetmaster dashboard. Run doctor.'
const DASHBOARD_URL_RE = /https?:\/\/([^\s/:]+):(\d+)\/?/

/** Durable Puppetmaster `job_…` token only (no path escapes). */
export function isDashboardJobId(jobId: string): boolean {
  const token = jobId.trim()
  if (!token || token.length > JOB_ID_MAX) return false
  if (!token.startsWith('job_')) return false
  const body = token.slice(4)
  return Boolean(body) && /^[A-Za-z0-9_-]+$/.test(body)
}

/** Jobs-rail aliases we may open the board for without deep-link. */
export function isBenignNonDurableJobToken(jobId: string): boolean {
  const token = jobId.trim()
  if (!token || token.length > JOB_ID_MAX) return false
  if (isDashboardJobId(token)) return false
  return /^[A-Za-z0-9_-]+$/.test(token)
}

/** Deep-link the local board. `embed=1` is best-effort; `?job=` always lands. */
export function buildDashboardUrl(
  host: string,
  port: number,
  jobId?: string | null,
  embed = true,
): string {
  const params = new URLSearchParams()
  const token = (jobId ?? '').trim()
  if (token && isDashboardJobId(token)) params.set('job', token)
  if (embed) params.set('embed', '1')
  const query = params.toString()
  return `http://${host}:${port}/${query ? `?${query}` : ''}`
}

export type DashboardLocate = {
  ok: boolean
  host: string
  port: number
  url: string
  embed_url: string
  reused?: boolean
  error?: string
}

export type DashboardSeams = {
  /** Run `puppetmaster dashboard` argv (no bin prefix); return stdout+stderr text. */
  run?: (argv: string[], cwd?: string) => { status: number; text: string }
  open?: (url: string) => { ok: boolean; error?: string }
  host?: string
  port?: number
  cwd?: string
  platform?: string
}

/**
 * Build embed URLs for a job. Live locate/spawn of the dashboard process is a
 * seam — tests inject `run`. Production uses `python -m puppetmaster dashboard`
 * (same CLI Marionette reuses).
 */
export function dashboardUrlsForJob(
  jobId: string | null | undefined,
  seams: DashboardSeams = {},
): Pick<DashboardLocate, 'host' | 'port' | 'url' | 'embed_url'> {
  const host = seams.host ?? DEFAULT_DASHBOARD_HOST
  const port = seams.port ?? DEFAULT_DASHBOARD_PORT
  const token = (jobId ?? '').trim()
  const deep = isDashboardJobId(token) ? token : undefined
  const embed_url = buildDashboardUrl(host, port, deep, true)
  const url = embed_url
  return { host, port, url, embed_url }
}

/** Parse host/port from stock `dashboard --status` / `--background` text. */
export function parseDashboardLocateText(
  text: string,
): { host: string; port: number; url: string } | null {
  const match = text.match(DASHBOARD_URL_RE)
  if (!match) return null
  const host = match[1]
  const port = Number(match[2])
  if (!host || !Number.isFinite(port) || port <= 0) return null
  return { host, port, url: `http://${host}:${port}/` }
}

function defaultDashboardRun(argv: string[], cwd?: string): { status: number; text: string } {
  const bin = resolvePm()
  const result = spawnSync(bin.command, [...bin.prefix, ...argv], {
    encoding: 'utf8',
    timeout: 20_000,
    cwd,
    env: pmEnv(),
  })
  return {
    status: result.status ?? 1,
    text: `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
  }
}

function failLocate(seams: DashboardSeams, error = LOCATE_FAIL): DashboardLocate {
  const host = seams.host ?? DEFAULT_DASHBOARD_HOST
  const port = seams.port ?? DEFAULT_DASHBOARD_PORT
  return {
    ok: false,
    host,
    port,
    url: '',
    embed_url: '',
    error,
  }
}

/**
 * Reuse or spawn the stock `puppetmaster dashboard` only. Durable `job_…` may
 * be a positional; aliases/overview omit it. Always returns `embed=1` URLs.
 */
export function ensureLocalDashboard(
  jobId?: string | null,
  seams: DashboardSeams = {},
): DashboardLocate {
  const cwd = seams.cwd ?? PRODUCT_ROOT
  const run = seams.run ?? defaultDashboardRun
  const token = (jobId ?? '').trim()
  const durable = isDashboardJobId(token) ? token : undefined

  if (!seams.run && runningTests()) {
    return {
      ok: true,
      reused: true,
      ...dashboardUrlsForJob(durable, seams),
    }
  }

  const status = run(['dashboard', '--status'], cwd)
  let found = parseDashboardLocateText(status.text)
  let reused = Boolean(found)

  if (!found) {
    const argv = ['dashboard', '--background', '--no-open']
    if (durable) argv.push(durable)
    const spawned = run(argv, cwd)
    found = parseDashboardLocateText(spawned.text)
    reused = false
  }

  if (!found) return failLocate(seams)

  const host = seams.host ?? found.host
  const port = seams.port ?? found.port
  const urls = dashboardUrlsForJob(durable, { host, port })
  return {
    ok: true,
    host,
    port,
    url: urls.url,
    embed_url: urls.embed_url,
    reused,
  }
}

/** Pop the board out via host Chrome / macOS `open`. No GPUIX webview. */
export function openDashboardUrl(
  url: string,
  seams: DashboardSeams = {},
): { ok: boolean; error?: string } {
  const target = url.trim()
  if (!target) return { ok: false, error: 'Need a dashboard URL.' }
  if (seams.open) return seams.open(target)
  if (runningTests()) return { ok: true }
  const platform = seams.platform ?? process.platform
  if (platform !== 'darwin') {
    return { ok: false, error: 'Open is macOS-only.' }
  }
  const result = spawnSync('open', [target], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "Couldn't open the dashboard.").trim() || LOCATE_FAIL,
    }
  }
  return { ok: true }
}
