import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Map a GitHub slug to a local git checkout. Never clone. */
export function resolveHomePath(slug: string): string | null {
  const repo = slug.split('/')[1]?.trim()
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
