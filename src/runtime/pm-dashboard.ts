/** Locate / deep-link the stock Puppetmaster dashboard. Never a second server. */

export const DEFAULT_DASHBOARD_HOST = '127.0.0.1'
export const DEFAULT_DASHBOARD_PORT = 8787
const JOB_ID_MAX = 128

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
  /** Run `puppetmaster dashboard` / doctor-style argv; return stdout text. */
  run?: (argv: string[], cwd?: string) => { status: number; text: string }
  host?: string
  port?: number
  cwd?: string
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
