import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURSOR_CLOUD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  PROVIDER_CATALOG,
  PROVIDERS_DOCS,
  doctorProviders,
  listModelsForProvider,
  listProviders,
  mouthProviders,
  providerAuthPresence,
  providerAvailabilityLabel,
  providerById,
  providerPickerLabel,
  providerStatusLabel,
} from '../src/runtime/providers'

describe('provider catalog', () => {
  test('maps known providers with one sanctioned auth path each', () => {
    const ids = listProviders().map((row) => row.id)
    expect(ids).toEqual([
      OPENROUTER_PROVIDER_ID,
      OPENAI_CODEX_PROVIDER_ID,
      CURSOR_CLOUD_PROVIDER_ID,
    ])
    expect(PROVIDER_CATALOG).toHaveLength(3)

    const openrouter = providerById('openrouter')
    expect(openrouter?.mouthSelectable).toBe(true)
    expect(openrouter?.availability).toBe('live')
    expect(openrouter?.auth.envVar).toBe('OPENROUTER_API_KEY')
    expect(openrouter?.auth.storeHint).toContain('keys.json')
    expect(openrouter?.modelsSource).toBe('openrouter-catalog')
    expect(openrouter?.roles).toContain('mouth')
    expect(openrouter?.roles).toContain('jobs')

    const codex = providerById('openai-codex')
    expect(codex?.mouthSelectable).toBe(false)
    expect(codex?.availability).toBe('jobs')
    expect(codex?.auth.envVar).toBe('OPENAI_CODEX_TOKEN')
    expect(codex?.auth.refuse).toMatch(/Never OPENAI_API_KEY/)
    expect(codex?.auth.refuse).toMatch(/Codex auth only/)
    expect(codex?.roles).toEqual(['jobs'])
    expect(codex?.modelsSource).toBe('none')

    const cloud = providerById('cursor-cloud')
    expect(cloud?.mouthSelectable).toBe(false)
    expect(cloud?.availability).toBe('parked')
    expect(cloud?.auth.envVar).toBe('CURSOR_API_KEY')
    expect(cloud?.roles).toEqual(['cloud'])
  })

  test('unknown provider is a miss, not a fake row', () => {
    expect(providerById('')).toBeNull()
    expect(providerById('openai-api')).toBeNull()
    expect(providerById('anthropic')).toBeNull()
    expect(providerById('made-up')).toBeNull()
  })

  test('mouth picker only lists live OpenRouter', () => {
    const mouths = mouthProviders()
    expect(mouths.map((row) => row.id)).toEqual([OPENROUTER_PROVIDER_ID])
    expect(mouths.every((row) => row.mouthSelectable)).toBe(true)
  })

  test('picker labels stay honest (no fake selectable Jobs/cloud mouths)', () => {
    expect(providerPickerLabel(providerById('openrouter')!)).toBe('OpenRouter · mouth (live)')
    expect(providerPickerLabel(providerById('openai-codex')!)).toBe('ChatGPT Codex · Jobs/PM')
    expect(providerPickerLabel(providerById('cursor-cloud')!)).toBe('Cursor Cloud Agents · parked')
    expect(providerAvailabilityLabel(providerById('openai-codex')!)).toBe('Jobs/PM')
  })
})

describe('provider auth presence', () => {
  test('OpenRouter reads env / vault only — never invents another key path', () => {
    const missing = providerAuthPresence('openrouter', {
      env: {},
      openRouterKeys: {
        env: {},
        automatonPath: join(tmpdir(), `no-keys-${Date.now()}.json`),
        marionetteStatePath: '',
        marionettePath: '',
      },
    })
    expect(missing).toEqual({ present: false, source: 'missing' })

    const fromEnv = providerAuthPresence('openrouter', {
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      openRouterKeys: {
        env: { OPENROUTER_API_KEY: 'sk-or-test' },
        automatonPath: join(tmpdir(), `no-keys-env-${Date.now()}.json`),
        marionetteStatePath: '',
        marionettePath: '',
      },
    })
    expect(fromEnv).toEqual({ present: true, source: 'env' })
  })

  test('Codex auth is OPENAI_CODEX_TOKEN or ~/.codex/auth.json — never OPENAI_API_KEY', () => {
    const withApiKeyOnly = providerAuthPresence('openai-codex', {
      env: { OPENAI_API_KEY: 'sk-openai-should-not-count' },
      codexAuthPath: join(tmpdir(), `no-codex-${Date.now()}.json`),
    })
    expect(withApiKeyOnly).toEqual({ present: false, source: 'missing' })

    const withToken = providerAuthPresence('openai-codex', {
      env: { OPENAI_CODEX_TOKEN: 'codex-token' },
      codexAuthPath: join(tmpdir(), `no-codex-2-${Date.now()}.json`),
    })
    expect(withToken).toEqual({ present: true, source: 'env' })

    const dir = mkdtempSync(join(tmpdir(), 'automaton-codex-'))
    const authPath = join(dir, 'auth.json')
    writeFileSync(authPath, '{"tokens":{}}\n')
    const withFile = providerAuthPresence('openai-codex', {
      env: {},
      codexAuthPath: authPath,
    })
    expect(withFile).toEqual({ present: true, source: 'codex-auth' })
  })

  test('Cursor cloud parks without CURSOR_API_KEY', () => {
    expect(providerAuthPresence('cursor-cloud', { env: {} })).toEqual({
      present: false,
      source: 'missing',
    })
    expect(providerAuthPresence('cursor-cloud', { env: { CURSOR_API_KEY: 'k' } })).toEqual({
      present: true,
      source: 'env',
    })
  })

  test('unknown id auth presence is null', () => {
    expect(providerAuthPresence('openai-api')).toBeNull()
  })
})

describe('listModelsForProvider', () => {
  test('unknown provider returns null (miss)', async () => {
    expect(await listModelsForProvider('openai-api')).toBeNull()
    expect(await listModelsForProvider('')).toBeNull()
  })

  test('Jobs/parked providers return empty catalog — not fake models', async () => {
    expect(await listModelsForProvider('openai-codex')).toEqual([])
    expect(await listModelsForProvider('cursor-cloud')).toEqual([])
  })

  test('OpenRouter catalog goes through connector fetch', async () => {
    const rows = await listModelsForProvider('openrouter', {
      bearer: 'test-key',
      fetch: (async () =>
        new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini', name: 'mini' }] }), {
          status: 200,
        })) as typeof fetch,
      home: mkdtempSync(join(tmpdir(), 'automaton-providers-')),
    })
    expect(rows).toEqual([{ id: 'openai/gpt-4o-mini', name: 'mini' }])
  })
})

describe('provider status + doctor', () => {
  test('status labels stay Need / Jobs/PM / parked', () => {
    const seams = {
      env: {},
      openRouterKeys: {
        env: {},
        automatonPath: join(tmpdir(), `doc-keys-${Date.now()}.json`),
        marionetteStatePath: '',
        marionettePath: '',
      },
      codexAuthPath: join(tmpdir(), `doc-codex-${Date.now()}.json`),
    }
    expect(providerStatusLabel(providerById('openrouter')!, seams)).toBe('Need key')
    expect(providerStatusLabel(providerById('openai-codex')!, seams)).toBe(
      'Jobs/PM · Need OPENAI_CODEX_TOKEN',
    )
    expect(providerStatusLabel(providerById('cursor-cloud')!, seams)).toBe(
      'parked · no CURSOR_API_KEY',
    )
  })

  test('doctor notes the map and docs; missing mouth key WARNs', () => {
    const warn = doctorProviders({
      env: {},
      openRouterKeys: {
        env: {},
        automatonPath: join(tmpdir(), `doc2-keys-${Date.now()}.json`),
        marionetteStatePath: '',
        marionettePath: '',
      },
    })
    expect(warn.status).toBe('warn')
    expect(warn.note).toContain(PROVIDERS_DOCS)
    expect(warn.note).toContain('openrouter')

    const ok = doctorProviders({
      env: { OPENROUTER_API_KEY: 'sk-or-ok' },
      openRouterKeys: {
        env: { OPENROUTER_API_KEY: 'sk-or-ok' },
        automatonPath: join(tmpdir(), `doc3-keys-${Date.now()}.json`),
        marionetteStatePath: '',
        marionettePath: '',
      },
    })
    expect(ok.status).toBe('ok')
    expect(ok.note).toContain(PROVIDERS_DOCS)
    expect(ok.note).toContain('mouth live')
  })
})
