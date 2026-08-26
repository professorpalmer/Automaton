import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { skillsRoot } from './computer'
import { automatonHome } from './keys'

export type SkillMeta = {
  id: string
  name: string
  description: string
  path: string
}

function parseFrontmatter(raw: string): { name: string; description: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '' }
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  return { name: name.replace(/^["']|["']$/g, ''), description: description.replace(/^["']|["']$/g, '') }
}

export function listSkills(home = automatonHome()): SkillMeta[] {
  const root = skillsRoot(home)
  if (!existsSync(root)) return []
  const out: SkillMeta[] = []
  for (const id of readdirSync(root)) {
    const path = join(root, id, 'SKILL.md')
    if (!existsSync(path)) continue
    const parsed = parseFrontmatter(readFileSync(path, 'utf8'))
    out.push({
      id,
      name: parsed.name || id,
      description: parsed.description,
      path,
    })
  }
  return out
}

export function ensureSkillsRoot(home = automatonHome()): string {
  const root = skillsRoot(home)
  mkdirSync(root, { recursive: true })
  return root
}
