import { describe, expect, test } from 'bun:test'
import {
  CLOUD_ORIGIN_DOCS,
  cloudPresenceLabel,
  doctorCloudOrigin,
  githubUrlFromHomeRepo,
  launchCloudImplement,
  neverGuessOriginFromGithub,
  normalizeGithubRepositoryUrl,
  parseCloudAgentPayload,
  parseOriginRemote,
  pollCloudAgent,
  probeCloudPresence,
  readExplicitOriginRemote,
  type CloudHttpResponse,
  type CloudOriginSeams,
} from '../src/runtime/cloud-origin'

function mockSeams(routes: Record<string, CloudHttpResponse>, apiKey = 'test-key'): CloudOriginSeams {
  return {
    apiKey: () => apiKey,
    apiBase: 'https://api.cursor.com/v0',
    fetch: async (url) => {
      const path = url.replace(/^https?:\/\/[^/]+\/v0/, '') || '/'
      const hit = routes[path] ?? routes['*']
      if (!hit) return { status: 404, text: JSON.stringify({ error: `no mock for ${path}` }) }
      return hit
    },
  }
}

describe('cloud-origin URL helpers', () => {
  test('normalizes GitHub remotes and homeRepo slugs', () => {
    expect(normalizeGithubRepositoryUrl('https://github.com/acme/app.git')).toBe(
      'https://github.com/acme/app',
    )
    expect(normalizeGithubRepositoryUrl('git@github.com:acme/app.git')).toBe(
      'https://github.com/acme/app',
    )
    expect(githubUrlFromHomeRepo('acme/app')).toBe('https://github.com/acme/app')
    expect(githubUrlFromHomeRepo('https://github.com/acme/app')).toBe('https://github.com/acme/app')
    expect(githubUrlFromHomeRepo('not a repo')).toBeNull()
  })

  test('Origin parse is explicit-only; never guesses from GitHub', () => {
    const origin = parseOriginRemote('https://origin.cursor.com/acme/checkout.git')
    expect(origin).toEqual({
      owner: 'acme',
      repo: 'checkout',
      cloneUrl: 'https://origin.cursor.com/acme/checkout.git',
      browseUrl: 'https://cursor.com/codebase/acme/checkout',
    })
    expect(parseOriginRemote('https://github.com/acme/checkout')).toBeNull()
    expect(neverGuessOriginFromGithub('https://github.com/acme/checkout')).toBeNull()
    expect(
      readExplicitOriginRemote('/tmp/repo', () => 'https://github.com/acme/checkout.git'),
    ).toBeNull()
    expect(
      readExplicitOriginRemote('/tmp/repo', () => 'https://origin.cursor.com/acme/checkout.git'),
    ).toBe('https://origin.cursor.com/acme/checkout.git')
  })
})

describe('cloud presence parked / ready', () => {
  test('missing key parks without a launchable flag', async () => {
    const presence = await probeCloudPresence({ apiKey: () => undefined, fetch: async () => ({ status: 500, text: '' }) })
    expect(presence.launchable).toBe(false)
    expect(presence.status).toBe('parked')
    expect(presence.reason).toBe('missing_key')
    expect(presence.note).toContain(CLOUD_ORIGIN_DOCS)
    expect(cloudPresenceLabel(presence)).toContain('parked')
  })

  test('privacy mode parks honestly (no fake ready)', async () => {
    const presence = await probeCloudPresence(
      mockSeams({
        '/me': { status: 200, text: JSON.stringify({ apiKeyName: 'M5' }) },
        '/agents?limit=1': {
          status: 400,
          text: JSON.stringify({
            error: 'Bad Request: Cloud agent is not supported in Privacy Mode (Legacy).',
          }),
        },
      }),
    )
    expect(presence.launchable).toBe(false)
    expect(presence.reason).toBe('privacy_mode')
    expect(presence.status).toBe('parked')
    expect(cloudPresenceLabel(presence)).toContain('privacy')
  })

  test('ready when me + list agents succeed', async () => {
    const presence = await probeCloudPresence(
      mockSeams({
        '/me': { status: 200, text: JSON.stringify({ apiKeyName: 'lab' }) },
        '/agents?limit=1': { status: 200, text: JSON.stringify({ agents: [] }) },
      }),
    )
    expect(presence.launchable).toBe(true)
    expect(presence.status).toBe('ready')
    expect(presence.apiKeyName).toBe('lab')
    expect(cloudPresenceLabel(presence)).toBe('ready')
  })
})

describe('launch + poll (public API shapes)', () => {
  test('launchCloudImplement posts source.repository and returns snapshot', async () => {
    const seams = mockSeams({
      '/agents': {
        status: 200,
        text: JSON.stringify({
          id: 'bc_test1',
          name: 'Add README',
          status: 'CREATING',
          source: { repository: 'https://github.com/acme/app', ref: 'main' },
          target: {
            url: 'https://cursor.com/agents?id=bc_test1',
            autoCreatePr: true,
          },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    })
    const launched = await launchCloudImplement(
      {
        repository: 'git@github.com:acme/app.git',
        prompt: 'Add a README',
        ref: 'main',
      },
      seams,
    )
    expect(launched.ok).toBe(true)
    if (!launched.ok) return
    expect(launched.value.id).toBe('bc_test1')
    expect(launched.value.agentUrl).toContain('bc_test1')
  })

  test('poll surfaces PR link when finished', async () => {
    const seams = mockSeams({
      '/agents/bc_done': {
        status: 200,
        text: JSON.stringify({
          id: 'bc_done',
          name: 'Done',
          status: 'FINISHED',
          source: { repository: 'https://github.com/acme/app' },
          target: {
            url: 'https://cursor.com/agents?id=bc_done',
            prUrl: 'https://github.com/acme/app/pull/12',
            branchName: 'cursor/add-readme',
          },
        }),
      },
    })
    const polled = await pollCloudAgent('bc_done', seams)
    expect(polled.ok).toBe(true)
    if (!polled.ok) return
    expect(polled.value.prUrl).toBe('https://github.com/acme/app/pull/12')
    expect(parseCloudAgentPayload({ id: 'x' })?.id).toBe('x')
  })

  test('launch refuses Origin-only URLs (GitHub required by public API)', async () => {
    const refused = await launchCloudImplement(
      {
        repository: 'https://origin.cursor.com/acme/app',
        prompt: 'nope',
      },
      mockSeams({}),
    )
    expect(refused.ok).toBe(false)
  })
})

describe('doctor cloud note', () => {
  test('defaults to parked checklist without flipping ok', () => {
    const doctor = doctorCloudOrigin()
    expect(doctor.status).toBe('parked')
    expect(doctor.note).toContain(CLOUD_ORIGIN_DOCS)
  })

  test('WARNs when presence is warn/auth; parks privacy; ok when launchable', () => {
    expect(
      doctorCloudOrigin({
        status: 'warn',
        reason: 'auth_failed',
        launchable: false,
        note: 'auth failed',
      }).status,
    ).toBe('warn')
    expect(
      doctorCloudOrigin({
        status: 'parked',
        reason: 'privacy_mode',
        launchable: false,
        note: 'parked privacy',
      }),
    ).toEqual({ status: 'parked', note: 'parked privacy' })
    expect(
      doctorCloudOrigin({
        status: 'ready',
        launchable: true,
        note: 'ready',
      }).status,
    ).toBe('ok')
  })
})
