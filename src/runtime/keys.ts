import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function automatonHome(): string {
  return join(homedir(), '.automaton')
}

export function automatonKeysPath(home = automatonHome()): string {
  return join(home, 'keys.json')
}

/** Live Marionette writes. Legacy `~/.pmharness/keys.json` can be a stale copy. */
export function marionetteStateKeysPath(): string {
  return join(homedir(), '.pmharness', 'state', 'keys.json')
}

export function marionetteLegacyKeysPath(): string {
  return join(homedir(), '.pmharness', 'keys.json')
}

export type KeySource = 'env' | 'automaton' | 'marionette' | 'missing'

export type ResolvedKey = { key: string; source: KeySource }

function readJsonKey(path: string, field: string): string {
  if (!existsSync(path)) return ''
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const value = raw[field]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

export type KeyLookup = {
  env?: NodeJS.ProcessEnv
  automatonPath?: string
  marionetteStatePath?: string
  marionettePath?: string
}

/** Distinct keys, env first. Callers must not log `key`. */
export function listOpenRouterKeys(input?: KeyLookup): ResolvedKey[] {
  const env = input?.env ?? process.env
  const automatonPath = input?.automatonPath ?? automatonKeysPath()
  const statePath = input?.marionetteStatePath ?? marionetteStateKeysPath()
  const legacyPath = input?.marionettePath ?? marionetteLegacyKeysPath()
  const rows: { key: string; source: Exclude<KeySource, 'missing'> }[] = [
    { key: (env.OPENROUTER_API_KEY ?? '').trim(), source: 'env' },
    { key: readJsonKey(automatonPath, 'openrouter'), source: 'automaton' },
    { key: readJsonKey(statePath, 'openrouter'), source: 'marionette' },
    { key: readJsonKey(legacyPath, 'openrouter'), source: 'marionette' },
  ]
  const seen = new Set<string>()
  const out: ResolvedKey[] = []
  for (const row of rows) {
    if (!row.key || seen.has(row.key)) continue
    seen.add(row.key)
    out.push(row)
  }
  return out
}

export function resolveOpenRouterKey(input?: KeyLookup): ResolvedKey {
  return listOpenRouterKeys(input)[0] ?? { key: '', source: 'missing' }
}

function writeAutomatonKey(dest: string, key: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, `${JSON.stringify({ openrouter: key }, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(dest, 0o600)
  } catch {
    /* best-effort */
  }
}

/** Copy Marionette's live OpenRouter key into ~/.automaton/keys.json. Never logs the secret. */
export function adoptMarionetteOpenRouterKey(input?: KeyLookup): {
  source: KeySource
  copied: boolean
} {
  const dest = input?.automatonPath ?? automatonKeysPath()
  const statePath = input?.marionetteStatePath ?? marionetteStateKeysPath()
  const legacyPath = input?.marionettePath ?? marionetteLegacyKeysPath()
  const stateKey = readJsonKey(statePath, 'openrouter')
  const legacyKey = readJsonKey(legacyPath, 'openrouter')
  const marionetteKey = stateKey || legacyKey
  if (!marionetteKey) return { source: 'missing', copied: false }
  const current = readJsonKey(dest, 'openrouter')
  if (current && current !== legacyKey) {
    return { source: 'automaton', copied: false }
  }
  if (current === marionetteKey) return { source: 'automaton', copied: false }
  writeAutomatonKey(dest, marionetteKey)
  return { source: 'marionette', copied: true }
}
