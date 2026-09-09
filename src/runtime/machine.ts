import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type MachineProject = { name: string; path: string; keys: string[] }

const WELL_KNOWN: { name: string; folder: string; keys: string[] }[] = [
  { name: 'Marionette', folder: 'marionette', keys: ['marionette', 'pm-harness', 'pm harness'] },
  { name: 'Puppetmaster', folder: 'Puppetmaster', keys: ['puppetmaster', 'puppet master'] },
  { name: 'Automaton', folder: 'Automaton', keys: ['automaton'] },
  { name: 'Wiki content', folder: 'my-portable-llm-wiki', keys: ['wiki content', 'personal wiki'] },
  { name: 'Wiki protocol', folder: 'portable-llm-wiki', keys: ['wiki protocol', 'portable llm wiki', 'portable-llm-wiki'] },
]

export function projectsRoot(): string {
  const override = process.env.AUTOMATON_PROJECTS_ROOT?.trim()
  return override || join(homedir(), 'Projects')
}

function isGitCheckout(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function extraKeys(folder: string): string[] {
  const lower = folder.toLowerCase()
  const row = WELL_KNOWN.find((item) => item.folder.toLowerCase() === lower)
  return row ? row.keys : []
}

function displayName(folder: string): string {
  const row = WELL_KNOWN.find((item) => item.folder.toLowerCase() === folder.toLowerCase())
  return row?.name ?? folder
}

function keysFor(folder: string): string[] {
  const lower = folder.toLowerCase()
  const spaced = lower.replace(/[-_]+/g, ' ')
  const keys = [lower, spaced, ...extraKeys(folder)]
  return [...new Set(keys.filter((key) => key.trim().length > 0))]
}

export function listMachineProjects(root = projectsRoot()): MachineProject[] {
  if (!existsSync(root)) return []
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const found: MachineProject[] = []
  for (const folder of names) {
    const path = join(root, folder)
    try {
      if (!statSync(path).isDirectory()) continue
    } catch {
      continue
    }
    if (!isGitCheckout(path)) continue
    found.push({ name: displayName(folder), path, keys: keysFor(folder) })
  }
  return found
}

export function listWellKnownProjects(root = projectsRoot()): MachineProject[] {
  const all = listMachineProjects(root)
  return WELL_KNOWN.flatMap((row) => {
    const hit = all.find((item) => item.path === join(root, row.folder))
    return hit ? [hit] : []
  })
}

export function formatWellKnown(projects: MachineProject[]): string {
  if (projects.length === 0) return ''
  return projects.map((row) => `${row.name} at ${row.path}`).join('. ') + '.'
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keyPattern(key: string): RegExp {
  const body = escapeRe(key).replace(/\\ /g, '\\s+')
  return new RegExp(`\\b${body}\\b`, 'i')
}

const TOOLING_VOCAB = /^(puppetmaster|puppet master|codegraph)$/i

function isToolingKey(key: string): boolean {
  return TOOLING_VOCAB.test(key.trim())
}

/** `via puppetmaster/codegraph` is runtime vocabulary, not a project subject. */
function isToolingFrame(text: string, key: string): boolean {
  if (/^codegraph$/i.test(key.trim())) return true
  const body = escapeRe(key).replace(/\\ /g, '\\s+')
  if (new RegExp(`\\b(?:via|using|through)\\s+${body}\\b`, 'i').test(text)) return true
  return new RegExp(`\\b${body}\\s*[/]\\s*codegraph\\b`, 'i').test(text)
}

/** Name/path hits beat tooling words. Tooling-only frames do not steal cwd. */
export function matchMachineProject(text: string, projects: MachineProject[]): MachineProject | null {
  type Hit = { project: MachineProject; len: number; tooling: boolean }
  let best: Hit | null = null
  const consider = (project: MachineProject, key: string, tooling: boolean) => {
    if (!best) {
      best = { project, len: key.length, tooling }
      return
    }
    if (best.tooling !== tooling) {
      if (!tooling) best = { project, len: key.length, tooling }
      return
    }
    if (key.length > best.len) best = { project, len: key.length, tooling }
  }
  for (const project of projects) {
    if (project.path && text.includes(project.path)) {
      consider(project, project.path, false)
    }
    const name = project.name.trim()
    const keys = name && !project.keys.some((key) => key.toLowerCase() === name.toLowerCase())
      ? [...project.keys, name]
      : project.keys
    for (const key of keys) {
      if (!keyPattern(key).test(text)) continue
      consider(project, key, isToolingKey(key) && isToolingFrame(text, key))
    }
  }
  if (!best || best.tooling) return null
  return best.project
}
