import { describe, expect, test } from 'bun:test'
import {
  buildDashboardUrl,
  dashboardUrlsForJob,
  isBenignNonDurableJobToken,
  isDashboardJobId,
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
