import { describe, expect, test } from 'bun:test'
import {
  buildDashboardUrl,
  dashboardUrlsForJob,
  ensureLocalDashboard,
  isBenignNonDurableJobToken,
  isDashboardJobId,
  openDashboardUrl,
  parseDashboardLocateText,
} from '../src/runtime/pm-dashboard'

describe('isDashboardJobId', () => {
  test('accepts durable job_ tokens', () => {
    expect(isDashboardJobId('job_abcdef012345')).toBe(true)
    expect(isDashboardJobId(' job_abc-1_2 ')).toBe(true)
  })
  test('rejects aliases and escapes', () => {
    expect(isDashboardJobId('local-swarm-call_1')).toBe(false)
    expect(isDashboardJobId('job_../etc')).toBe(false)
    expect(isDashboardJobId('')).toBe(false)
    expect(isDashboardJobId('jobs_abc')).toBe(false)
  })
})

describe('isBenignNonDurableJobToken', () => {
  test('allows rail aliases without deep-link', () => {
    expect(isBenignNonDurableJobToken('local-swarm-call_1')).toBe(true)
    expect(isBenignNonDurableJobToken('job_abcdef')).toBe(false)
  })
})

describe('buildDashboardUrl', () => {
  test('always asks for embed=1 and keeps the job query', () => {
    expect(buildDashboardUrl('127.0.0.1', 8787, 'job_abcdef012345')).toBe(
      'http://127.0.0.1:8787/?job=job_abcdef012345&embed=1',
    )
  })
  test('omits job for non-durable tokens but still embeds', () => {
    expect(buildDashboardUrl('127.0.0.1', 8791, 'local-swarm-call_1')).toBe(
      'http://127.0.0.1:8791/?embed=1',
    )
    expect(buildDashboardUrl('127.0.0.1', 8791)).toBe('http://127.0.0.1:8791/?embed=1')
  })
})

describe('dashboardUrlsForJob', () => {
  test('deep-links durable ids only', () => {
    const durable = dashboardUrlsForJob('job_abcdef012345')
    expect(durable.embed_url).toContain('job=job_abcdef012345')
    expect(durable.embed_url).toContain('embed=1')
    const alias = dashboardUrlsForJob('local-swarm-call_9')
    expect(alias.embed_url).toBe('http://127.0.0.1:8787/?embed=1')
  })
})

describe('parseDashboardLocateText', () => {
  test('reads status and background lines', () => {
    expect(parseDashboardLocateText('Background dashboard running: http://127.0.0.1:8794/ (pid 1).')).toEqual({
      host: '127.0.0.1',
      port: 8794,
      url: 'http://127.0.0.1:8794/',
    })
    expect(
      parseDashboardLocateText(
        'Dashboard running in the background (pid 1).\n  http://127.0.0.1:8787/\nStop it with: …',
      ),
    ).toEqual({
      host: '127.0.0.1',
      port: 8787,
      url: 'http://127.0.0.1:8787/',
    })
    expect(parseDashboardLocateText('No background dashboard is running for this state dir.')).toBeNull()
  })
})

describe('ensureLocalDashboard', () => {
  test('reuses a live board and keeps durable ?job=&embed=1', () => {
    const calls: string[][] = []
    const located = ensureLocalDashboard('job_abcdef012345', {
      run: (argv) => {
        calls.push(argv)
        return {
          status: 0,
          text: 'Background dashboard running: http://127.0.0.1:8791/ (pid 9).',
        }
      },
    })
    expect(calls).toEqual([['dashboard', '--status']])
    expect(located.ok).toBe(true)
    expect(located.reused).toBe(true)
    expect(located.port).toBe(8791)
    expect(located.embed_url).toBe('http://127.0.0.1:8791/?job=job_abcdef012345&embed=1')
  })

  test('spawns stock dashboard when status is empty; durable is positional', () => {
    const calls: string[][] = []
    const located = ensureLocalDashboard('job_spawnme01', {
      run: (argv) => {
        calls.push(argv)
        if (argv.includes('--status')) {
          return { status: 0, text: 'No background dashboard is running for this state dir.' }
        }
        return {
          status: 0,
          text: 'Dashboard running in the background (pid 2).\n  http://127.0.0.1:8802/\n',
        }
      },
    })
    expect(calls[0]).toEqual(['dashboard', '--status'])
    expect(calls[1]).toEqual(['dashboard', '--background', '--no-open', 'job_spawnme01'])
    expect(located.ok).toBe(true)
    expect(located.reused).toBe(false)
    expect(located.embed_url).toBe('http://127.0.0.1:8802/?job=job_spawnme01&embed=1')
  })

  test('aliases and overview omit job on spawn and URL', () => {
    const calls: string[][] = []
    const alias = ensureLocalDashboard('local-swarm-call_1', {
      run: (argv) => {
        calls.push(argv)
        if (argv.includes('--status')) {
          return { status: 0, text: 'No background dashboard is running for this state dir.' }
        }
        return { status: 0, text: 'http://127.0.0.1:8787/' }
      },
    })
    expect(calls[1]).toEqual(['dashboard', '--background', '--no-open'])
    expect(alias.embed_url).toBe('http://127.0.0.1:8787/?embed=1')

    const overview = ensureLocalDashboard(null, {
      run: () => ({ status: 0, text: 'Background dashboard running: http://127.0.0.1:8788/ (pid 3).' }),
    })
    expect(overview.embed_url).toBe('http://127.0.0.1:8788/?embed=1')
  })

  test('fails closed when locate cannot parse a URL', () => {
    const located = ensureLocalDashboard('job_missing', {
      run: () => ({ status: 1, text: 'command not found' }),
    })
    expect(located.ok).toBe(false)
    expect(located.embed_url).toBe('')
    expect(located.error).toContain('doctor')
  })
})

describe('openDashboardUrl', () => {
  test('uses the open seam and rejects empty URLs', () => {
    const opened: string[] = []
    expect(openDashboardUrl('')).toEqual({ ok: false, error: 'Need a dashboard URL.' })
    expect(
      openDashboardUrl('http://127.0.0.1:8787/?embed=1', {
        open: (url) => {
          opened.push(url)
          return { ok: true }
        },
      }),
    ).toEqual({ ok: true })
    expect(opened).toEqual(['http://127.0.0.1:8787/?embed=1'])
  })
})
