import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PRODUCT_ROOT } from './pm'

/** Map a GitHub slug or a bare local repo name to an expected ~/Projects/<repo> path. */
export function expectedProjectsPath(slug: string, projectsRoot = join(homedir(), 'Projects')): string | null {
  const parts = slug.split('/')
  const repo = (parts[1] ?? parts[0])?.trim()
  if (!repo) return null
  return join(projectsRoot, repo)
}

/** True when origin and url name the same GitHub repo (https or ssh). */
export function remoteMatches(origin: string, url: string): boolean {
  const norm = (raw: string): string => {
    let s = raw.trim().toLowerCase()
    s = s.replace(/\.git$/i, '')
    s = s.replace(/^git@github\.com:/i, 'github.com/')
    s = s.replace(/^ssh:\/\/git@github\.com\//i, 'github.com/')
    s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, 'github.com/')
    return s
  }
  const left = norm(origin)
  const right = norm(url)
  return Boolean(left && right && left === right)
}

export type EnsureHomeSeams = {
  projectsRoot?: string
  productRoot?: string
  exists?: (path: string) => boolean
  isGit?: (path: string) => boolean
  readOrigin?: (path: string) => string | null
  clone?: (url: string, path: string) => { ok: boolean; stderr?: string }
  mkdir?: (path: string) => void
}

export type EnsureHomeResult = {
  ok: boolean
  path?: string
  cloned?: boolean
  spoken?: string
  error?: string
}

function defaultIsGit(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function defaultReadOrigin(path: string): string | null {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: path,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
  })
  if ((result.status ?? 1) !== 0) return null
  const url = (result.stdout ?? '').trim()
  return url || null
}

function defaultClone(url: string, path: string): { ok: boolean; stderr?: string } {
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true })
  const result = spawnSync('git', ['clone', url, path], {
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
  })
  if ((result.status ?? 1) === 0) return { ok: true }
  const stderr = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim()
  return { ok: false, stderr }
}

function stderrSnippet(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((row) => row.trim())
    .find((row) => row.length > 0)
  if (!line) return 'clone failed'
  return line.length > 160 ? `${line.slice(0, 157)}...` : line
}

/**
 * Ensure a home checkout under ~/Projects/<repo>. May clone once for a GitHub URL.
 * Never clones into the Automaton product tree. Fail closed with an honest Need.
 */
export function ensureHomeCheckout(
  input: { slug: string; url?: string },
  seams: EnsureHomeSeams = {},
): EnsureHomeResult {
  const projectsRoot = seams.projectsRoot ?? join(homedir(), 'Projects')
  const productRoot = resolve(seams.productRoot ?? PRODUCT_ROOT)
  const exists = seams.exists ?? ((path: string) => existsSync(path))
  const isGit = seams.isGit ?? defaultIsGit
  const readOrigin = seams.readOrigin ?? defaultReadOrigin
  const clone = seams.clone ?? defaultClone
  const mkdir = seams.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }))

  const target = expectedProjectsPath(input.slug, projectsRoot)
  if (!target) {
    return { ok: false, error: 'Need a local checkout path.' }
  }

  const resolvedTarget = resolve(target)
  if (resolvedTarget === productRoot) {
    return {
      ok: false,
      error: `Need: refusing to use the Automaton checkout as home for ${input.slug}.`,
    }
  }

  const display = `~/Projects/${target.slice(projectsRoot.length).replace(/^[/\\]/, '') || input.slug}`

  if (exists(target) && isGit(target)) {
    const url = input.url?.trim()
    if (url) {
      const origin = readOrigin(target)
      if (origin && !remoteMatches(origin, url)) {
        return {
          ok: false,
          error: `Need: ${display} has a different remote.`,
        }
      }
    }
    return { ok: true, path: target, cloned: false }
  }

  if (exists(target)) {
    return {
      ok: false,
      error: `Need: ${display} exists but is not a git checkout.`,
    }
  }

  const url = input.url?.trim()
  if (!url) {
    return {
      ok: false,
      error: `Need a local checkout at ${display}.`,
    }
  }

  const spoken = `Cloning ${input.slug}…`
  mkdir(projectsRoot)
  const cloned = clone(url, target)
  if (!cloned.ok) {
    return {
      ok: false,
      spoken,
      error: `Need: ${stderrSnippet(cloned.stderr ?? '')}`,
    }
  }
  return { ok: true, path: target, cloned: true, spoken }
}

/** Read-only lookup: existing ~/Projects/<repo> with .git, or null. Never clones. */
export function resolveHomePath(slug: string): string | null {
  const parts = slug.split('/')
  const repo = (parts[1] ?? parts[0])?.trim()
  if (!repo) return null
  const guesses = [join(homedir(), 'Projects', repo), join(homedir(), 'Projects', repo.toLowerCase())]
  const seen = new Set<string>()
  for (const path of guesses) {
    if (seen.has(path)) continue
    seen.add(path)
    if (existsSync(join(path, '.git'))) return path
  }
  return null
}
