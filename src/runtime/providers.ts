/**
 * Automaton provider catalog — mouths vs Jobs/PM vs optional cloud.
 *
 * Distinct from `provider-maps.ts` (verified OpenRouter *reasoning-control*
 * maps). This module is the product-real provider → auth → models-source map.
 *
 * Unknown provider id = miss (null / empty), never a fake selectable mouth row.
 * No cookie scrape. Missing auth → Need / secret-request / parked — never invent
 * an alternate key path (Palmer lock: OpenAI-class Jobs use Codex auth only).
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { listOpenRouterModels, type CatalogModel, type ConnectorFetchSeams } from './connector-client'
import { listOpenRouterKeys, type KeyLookup } from './keys'

export const PROVIDERS_DOCS = 'docs/providers.md'

export type ProviderAuthKind = 'openrouter-key' | 'codex-oauth' | 'cursor-api-key'

export type ProviderAuth = {
  kind: ProviderAuthKind
  /** Single sanctioned env var for this provider. */
  envVar: string
  /** Vault / login hint shown in Settings and docs. */
  storeHint: string
  /** Explicit refuse line when an invented path would be wrong. */
  refuse?: string
}

export type ProviderModelsSource = 'openrouter-catalog' | 'none'

export type ProviderRole = 'mouth' | 'jobs' | 'cloud'

/**
 * Product availability for Automaton UI honesty.
 * - live: wired mouth and/or default Jobs path
 * - jobs: supported for Puppetmaster Jobs/PM; not a mouth picker row
 * - parked: documented opt-in; Settings shows parked — no fake select/Launch
 */
export type ProviderAvailability = 'live' | 'jobs' | 'parked'

export type ProviderEntry = {
  id: string
  name: string
  roles: readonly ProviderRole[]
  availability: ProviderAvailability
  auth: ProviderAuth
  modelsSource: ProviderModelsSource
  /** Mouth model picker only lists live mouth-selectable providers. */
  mouthSelectable: boolean
  summary: string
}

export const OPENROUTER_PROVIDER_ID = 'openrouter'
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex'
export const CURSOR_CLOUD_PROVIDER_ID = 'cursor-cloud'

export const PROVIDER_CATALOG: readonly ProviderEntry[] = Object.freeze([
  {
    id: OPENROUTER_PROVIDER_ID,
    name: 'OpenRouter',
    roles: ['mouth', 'jobs'],
    availability: 'live',
    auth: {
      kind: 'openrouter-key',
      envVar: 'OPENROUTER_API_KEY',
      storeHint: '~/.automaton/keys.json',
    },
    modelsSource: 'openrouter-catalog',
    mouthSelectable: true,
    summary: 'Live HTTP mouth and default Puppetmaster agentic Jobs provider.',
  },
  {
    id: OPENAI_CODEX_PROVIDER_ID,
    name: 'ChatGPT Codex',
    roles: ['jobs'],
    availability: 'jobs',
    auth: {
      kind: 'codex-oauth',
      envVar: 'OPENAI_CODEX_TOKEN',
      storeHint: '~/.codex/auth.json (codex login) or OPENAI_CODEX_TOKEN',
      refuse: 'Never OPENAI_API_KEY / openai-api for Automaton OpenAI-class Jobs — Codex auth only.',
    },
    modelsSource: 'none',
    mouthSelectable: false,
    summary:
      'Jobs/PM via Puppetmaster agentic when stamped openai-codex. Not a mouth HTTP provider.',
  },
  {
    id: CURSOR_CLOUD_PROVIDER_ID,
    name: 'Cursor Cloud Agents',
    roles: ['cloud'],
    availability: 'parked',
    auth: {
      kind: 'cursor-api-key',
      envVar: 'CURSOR_API_KEY',
      storeHint: 'process env CURSOR_API_KEY (Cursor Dashboard → API Keys)',
    },
    modelsSource: 'none',
    mouthSelectable: false,
    summary:
      'Optional public Cloud Agents transport beside local Puppetmaster Jobs. See docs/cloud-origin.md.',
  },
])

export type ProviderAuthPresence = {
  present: boolean
  source: 'env' | 'vault' | 'codex-auth' | 'missing'
}

export type ProviderAuthSeams = {
  env?: NodeJS.ProcessEnv
  openRouterKeys?: KeyLookup
  codexAuthPath?: string
  homeDir?: string
}

/** Catalog snapshot — unknown id is a miss. */
export function providerById(id: string): ProviderEntry | null {
  const trimmed = id.trim()
  if (!trimmed) return null
  return PROVIDER_CATALOG.find((row) => row.id === trimmed) ?? null
}

export function listProviders(): ProviderEntry[] {
  return [...PROVIDER_CATALOG]
}

/** Mouth picker providers only — never invents parked/Jobs-only rows. */
export function mouthProviders(): ProviderEntry[] {
  return PROVIDER_CATALOG.filter((row) => row.mouthSelectable && row.roles.includes('mouth'))
}

export function providerAvailabilityLabel(entry: ProviderEntry): string {
  if (entry.availability === 'live') return 'live'
  if (entry.availability === 'jobs') return 'Jobs/PM'
  return 'parked'
}

export function providerPickerLabel(entry: ProviderEntry): string {
  const avail = providerAvailabilityLabel(entry)
  if (entry.mouthSelectable) return `${entry.name} · mouth (${avail})`
  if (entry.roles.includes('jobs')) return `${entry.name} · ${avail}`
  if (entry.roles.includes('cloud')) return `${entry.name} · ${avail}`
  return `${entry.name} · ${avail}`
}

function codexAuthJsonPath(seams?: ProviderAuthSeams): string {
  if (seams?.codexAuthPath) return seams.codexAuthPath
  const env = seams?.env ?? process.env
  const codexHome = env.CODEX_HOME?.trim()
  if (codexHome) return join(codexHome, 'auth.json')
  const home = seams?.homeDir ?? homedir()
  return join(home, '.codex', 'auth.json')
}

/**
 * Sanctioned auth presence only. Does not invent openai-api / cookie paths.
 * Values are never returned — presence + coarse source only.
 */
export function providerAuthPresence(id: string, seams?: ProviderAuthSeams): ProviderAuthPresence | null {
  const entry = providerById(id)
  if (!entry) return null
  const env = seams?.env ?? process.env

  if (entry.auth.kind === 'openrouter-key') {
    const keys = listOpenRouterKeys(seams?.openRouterKeys ?? { env })
    if (keys.length === 0) return { present: false, source: 'missing' }
    const source = keys[0].source === 'env' ? 'env' : 'vault'
    return { present: true, source }
  }

  if (entry.auth.kind === 'codex-oauth') {
    if ((env.OPENAI_CODEX_TOKEN ?? '').trim()) return { present: true, source: 'env' }
    if (existsSync(codexAuthJsonPath(seams))) return { present: true, source: 'codex-auth' }
    return { present: false, source: 'missing' }
  }

  if (entry.auth.kind === 'cursor-api-key') {
    if ((env.CURSOR_API_KEY ?? '').trim()) return { present: true, source: 'env' }
    return { present: false, source: 'missing' }
  }

  return { present: false, source: 'missing' }
}

export function providerStatusLabel(entry: ProviderEntry, seams?: ProviderAuthSeams): string {
  const auth = providerAuthPresence(entry.id, seams)
  if (entry.availability === 'parked') {
    if (!auth?.present) return `parked · no ${entry.auth.envVar}`
    return 'parked · auth present (opt-in probe in Cloud / Origin)'
  }
  if (entry.availability === 'jobs') {
    if (!auth?.present) return `Jobs/PM · Need ${entry.auth.envVar}`
    return 'Jobs/PM · auth present'
  }
  if (!auth?.present) return 'Need key'
  return 'live'
}

/**
 * Models for a provider id. Unknown id → null (miss). Known without an
 * Automaton catalog → [] (honest empty, not a fake row).
 */
export async function listModelsForProvider(
  id: string,
  seams?: ConnectorFetchSeams,
): Promise<CatalogModel[] | null> {
  const entry = providerById(id)
  if (!entry) return null
  if (entry.modelsSource === 'openrouter-catalog') {
    return listOpenRouterModels(seams)
  }
  return []
}

/** Doctor checklist — never flips DoctorReport.ok alone. */
export function doctorProviders(seams?: ProviderAuthSeams): {
  status: 'ok' | 'warn' | 'parked'
  note: string
} {
  const mouth = mouthProviders()
  const missingMouth = mouth.filter((row) => !providerAuthPresence(row.id, seams)?.present)
  if (missingMouth.length > 0) {
    return {
      status: 'warn',
      note: `mouth provider Need key (${missingMouth.map((r) => r.id).join(', ')}) — ${PROVIDERS_DOCS}`,
    }
  }
  const parked = PROVIDER_CATALOG.filter((row) => row.availability === 'parked')
  const parkedBits = parked.map((row) => {
    const auth = providerAuthPresence(row.id, seams)
    return auth?.present ? `${row.id}:auth` : `${row.id}:parked`
  })
  return {
    status: 'ok',
    note: `providers map ok (mouth live; ${parkedBits.join(', ') || 'no parked'}) — ${PROVIDERS_DOCS}`,
  }
}
