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

/** Longest key that appears as a whole phrase wins. Ties keep the first path. */
export function matchMachineProject(text: string, projects: MachineProject[]): MachineProject | null {
  let best: { project: MachineProject; len: number } | null = null
  for (const project of projects) {
    for (const key of project.keys) {
      if (!keyPattern(key).test(text)) continue
      if (!best || key.length > best.len) best = { project, len: key.length }
    }
  }
  return best?.project ?? null
}
