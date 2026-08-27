import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { skillsRoot } from './computer'
import { automatonHome } from './keys'

/** Folder name is the only path under the skills dir. No `..`, slashes, or case. */
export const SKILL_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const CATALOG_MAX_SKILLS = 15
export const CATALOG_MAX_BYTES = 4096
const SKILL_MAX_BYTES = 256 * 1024
const SCRIPT_ENTRY = /(^|\/)scripts\/|\.(?:sh|bash|zsh|fish|ps1|py|js|mjs|cjs|exe|bin|command)$/i

export type SkillOrigin = 'local' | 'imported'

export type SkillMeta = {
  id: string
  name: string
  description: string
  path: string
  enabled: boolean
  origin: SkillOrigin
  sourceUrl?: string
  contentHash?: string
  scriptsSkipped?: boolean
  disableModelInvocation?: boolean
}

export type SkillImportResult = {
  skill: SkillMeta
  note: string
  scriptsSkipped: boolean
}

type SkillPin = {
  url: string
  hash: string
  importedAt: string
  enabled: boolean
  scriptsSkipped: boolean
}

export function isSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id) && id.length <= 64
}

export function slugSkillId(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return isSkillId(slug) ? slug : null
}

export function skillDir(id: string, home = automatonHome()): string {
  if (!isSkillId(id)) throw new Error('invalid skill id')
  const root = resolve(skillsRoot(home))
  const dir = resolve(join(root, id))
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (dir !== root && !dir.startsWith(prefix)) throw new Error('invalid skill id')
  return dir
}

export function hashSkillContent(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function parseFrontmatter(raw: string): {
  name: string
  description: string
  disableModelInvocation: boolean
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '', disableModelInvocation: false }
  const block = match[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const invocation = block.match(/^disable-model-invocation:\s*(.+)$/m)?.[1]?.trim().toLowerCase() ?? ''
  return {
    name: name.replace(/^["']|["']$/g, ''),
    description: description.replace(/^["']|["']$/g, ''),
    disableModelInvocation: invocation === 'true' || invocation === 'yes' || invocation === '1',
  }
}

export function skillBody(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n?/)
  return (match ? raw.slice(match[0].length) : raw).trim()
}

function pinPath(id: string, home = automatonHome()): string {
  return join(skillDir(id, home), 'pin.json')
}

function readPin(id: string, home = automatonHome()): SkillPin | null {
  const path = pinPath(id, home)
  if (!existsSync(path)) return null
  try {
    const row = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (typeof row.url !== 'string' || typeof row.hash !== 'string') return null
    return {
      url: row.url,
      hash: row.hash,
      importedAt: typeof row.importedAt === 'string' ? row.importedAt : '',
      enabled: row.enabled === true,
      scriptsSkipped: row.scriptsSkipped === true,
    }
  } catch {
    return null
  }
}

function writePin(id: string, pin: SkillPin, home = automatonHome()): void {
  writeFileSync(pinPath(id, home), `${JSON.stringify(pin, null, 2)}\n`)
}

function metaFromDir(id: string, home: string): SkillMeta | null {
  if (!isSkillId(id)) return null
  const path = join(skillDir(id, home), 'SKILL.md')
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  const parsed = parseFrontmatter(raw)
  const pin = readPin(id, home)
  const imported = Boolean(pin)
  return {
    id,
    name: parsed.name || id,
    description: parsed.description,
    path,
    enabled: imported ? pin!.enabled : true,
    origin: imported ? 'imported' : 'local',
    sourceUrl: pin?.url,
    contentHash: pin?.hash,
    scriptsSkipped: pin?.scriptsSkipped,
    disableModelInvocation: parsed.disableModelInvocation,
  }
}

export function listSkills(home = automatonHome()): SkillMeta[] {
  const root = skillsRoot(home)
  if (!existsSync(root)) return []
  const out: SkillMeta[] = []
  for (const id of readdirSync(root)) {
    const meta = metaFromDir(id, home)
    if (meta) out.push(meta)
  }
  return out
}

export function ensureSkillsRoot(home = automatonHome()): string {
  const root = skillsRoot(home)
  mkdirSync(root, { recursive: true })
  return root
}

export function setSkillEnabled(id: string, enabled: boolean, home = automatonHome()): SkillMeta {
  const meta = metaFromDir(id, home)
  if (!meta) throw new Error('unknown skill')
  if (meta.origin === 'local') return meta
  const pin = readPin(id, home)
  if (!pin) throw new Error('unknown skill')
  writePin(id, { ...pin, enabled }, home)
  const next = metaFromDir(id, home)
  if (!next) throw new Error('unknown skill')
  return next
}

export function catalogSkills(skills: SkillMeta[]): SkillMeta[] {
  return skills.filter((skill) => skill.enabled && !skill.disableModelInvocation)
}

function catalogLine(skill: SkillMeta): string {
  const desc = skill.description.trim()
  return desc ? `${skill.id} — ${desc}` : skill.id
}

export function budgetCatalog(skills: SkillMeta[], pinnedIds: string[] = []): SkillMeta[] {
  const eligible = catalogSkills(skills)
  const pinned = new Set(pinnedIds)
  const ordered = [
    ...eligible.filter((skill) => pinned.has(skill.id)),
    ...eligible.filter((skill) => !pinned.has(skill.id)),
  ]
  const out: SkillMeta[] = []
  let bytes = 0
  for (const skill of ordered) {
    if (out.length >= CATALOG_MAX_SKILLS) break
    const line = catalogLine(skill)
    const extra = out.length === 0 ? line.length : line.length + 1
    if (out.length > 0 && bytes + extra > CATALOG_MAX_BYTES) break
    if (out.length === 0 && extra > CATALOG_MAX_BYTES) {
      out.push(skill)
      break
    }
    out.push(skill)
    bytes += extra
  }
  return out
}

export function formatSkillCatalog(skills: SkillMeta[]): string {
  if (skills.length === 0) return ''
  const lines = skills.map(catalogLine).join('\n')
  return `Skills (name + description; full text loads on match, pin, or @name):\n${lines}`
}

function mentionedIn(query: string, skill: SkillMeta): boolean {
  const q = query.toLowerCase()
  const id = skill.id.toLowerCase()
  const name = skill.name.trim().toLowerCase()
  if (q.includes(`@${id}`)) return true
  if (name && q.includes(`@${name}`)) return true
  return false
}

function matchedIn(query: string, skill: SkillMeta): boolean {
  if (mentionedIn(query, skill)) return true
  if (skill.disableModelInvocation) return false
  const q = query.toLowerCase()
  if (new RegExp(`\\b${skill.id}\\b`, 'i').test(query)) return true
  const name = skill.name.trim()
  if (name.length >= 3 && q.includes(name.toLowerCase())) return true
  return false
}

export function selectSkillBodies(skills: SkillMeta[], pinnedIds: string[], query: string): SkillMeta[] {
  const pinned = new Set(pinnedIds)
  return skills.filter((skill) => {
    if (!skill.enabled) return false
    if (pinned.has(skill.id) || mentionedIn(query, skill) || matchedIn(query, skill)) return true
    return false
  })
}

export function formatSkillBodies(skills: SkillMeta[]): string {
  const parts: string[] = []
  for (const skill of skills) {
    const body = existsSync(skill.path) ? skillBody(readFileSync(skill.path, 'utf8')) : ''
    if (!body) continue
    const skip = skill.scriptsSkipped ? '\nScripts were not imported.' : ''
    parts.push(`Skill ${skill.id}:\n${body}${skip}`)
  }
  return parts.join('\n\n')
}

export function skillPromptLayers(input: {
  skills?: SkillMeta[]
  pinnedIds?: string[]
  query?: string
  intro?: boolean
}): { catalog: string; bodies: string } {
  const skills = input.skills ?? []
  const pinnedIds = input.pinnedIds ?? []
  const catalog = formatSkillCatalog(budgetCatalog(skills, pinnedIds))
  const bodies = input.intro ? '' : formatSkillBodies(selectSkillBodies(skills, pinnedIds, input.query ?? ''))
  return { catalog, bodies }
}

function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 80).toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html')
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0
}

function unzipEntries(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = []
  let offset = 0
  while (offset + 30 <= bytes.length) {
    const sig = readU32(bytes, offset)
    if (sig === 0x02014b50 || sig === 0x06054b50) break
    if (sig !== 0x04034b50) break
    const flags = readU16(bytes, offset + 6)
    const method = readU16(bytes, offset + 8)
    const compressed = readU32(bytes, offset + 18)
    const nameLen = readU16(bytes, offset + 26)
    const extraLen = readU16(bytes, offset + 28)
    const nameStart = offset + 30
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLen))
    const dataStart = nameStart + nameLen + extraLen
    if (flags & 0x8) break
    const dataEnd = dataStart + compressed
    if (dataEnd > bytes.length) break
    const packed = bytes.slice(dataStart, dataEnd)
    let data = packed
    if (method === 8) data = new Uint8Array(inflateRawSync(packed))
    else if (method !== 0) {
      offset = dataEnd
      continue
    }
    out.push({ name, data })
    offset = dataEnd
  }
  return out
}

function extractZipSkill(bytes: Uint8Array): { markdown: string; scriptsPresent: boolean } | null {
  const files = unzipEntries(bytes)
  if (files.length === 0) return null
  const scriptsPresent = files.some((file) => SCRIPT_ENTRY.test(file.name))
  const skill = files.find((file) => file.name.split('/').pop() === 'SKILL.md')
  if (!skill) return null
  return { markdown: new TextDecoder().decode(skill.data), scriptsPresent }
}

export function skillMarkdownUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('skill import needs an http(s) URL')
  }
  if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts[2] === 'blob' && parts.length >= 5) {
      const [owner, repo, , ref, ...rest] = parts
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join('/')}`
    }
    if (parts[2] === 'tree' && parts.length >= 4) {
      const [owner, repo, , ref, ...rest] = parts
      const path = rest.join('/')
      const file = !path || path.endsWith('SKILL.md') ? path || 'SKILL.md' : `${path.replace(/\/$/, '')}/SKILL.md`
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`
    }
  }
  return url
}

function idFromMarkdown(raw: string, url: string): string {
  const parsed = parseFrontmatter(raw)
  const fromName = slugSkillId(parsed.name)
  if (fromName) return fromName
  let path = ''
  try {
    path = new URL(url).pathname
  } catch {
    path = url
  }
  const parts = path.split('/').filter(Boolean)
  const last = parts[parts.length - 1] === 'SKILL.md' ? parts[parts.length - 2] : parts[parts.length - 1]
  const fromUrl = last ? slugSkillId(last.replace(/\.md$/i, '')) : null
  if (fromUrl) return fromUrl
  throw new Error('invalid skill id')
}

export function importSkillMarkdown(input: {
  home?: string
  url: string
  markdown: string
  scriptsPresent?: boolean
  now?: string
}): SkillImportResult {
  const home = input.home ?? automatonHome()
  const markdown = input.markdown.replace(/^\uFEFF/, '')
  if (!markdown.trim()) throw new Error('empty skill')
  if (looksLikeHtml(markdown)) throw new Error('import SKILL.md, not a web page')
  if (Buffer.byteLength(markdown, 'utf8') > SKILL_MAX_BYTES) throw new Error('skill too large')
  const id = idFromMarkdown(markdown, input.url)
  const dir = skillDir(id, home)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'SKILL.md')
  if (existsSync(path)) throw new Error(`skill ${id} already exists`)
  writeFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`)
  const hash = hashSkillContent(markdown.endsWith('\n') ? markdown : `${markdown}\n`)
  const scriptsSkipped = Boolean(input.scriptsPresent)
  writePin(
    id,
    {
      url: input.url,
      hash,
      importedAt: input.now ?? new Date().toISOString(),
      enabled: false,
      scriptsSkipped,
    },
    home,
  )
  const skill = metaFromDir(id, home)
  if (!skill) throw new Error('import failed')
  const note = scriptsSkipped
    ? `Landed ${id} disabled. Scripts skipped.`
    : `Landed ${id} disabled.`
  return { skill, note, scriptsSkipped }
}

export async function importSkillFromUrl(
  url: string,
  options?: { home?: string; fetch?: typeof fetch; now?: string },
): Promise<SkillImportResult> {
  const target = skillMarkdownUrl(url)
  const fn = options?.fetch ?? fetch
  const response = await fn(target, {
    headers: { Accept: 'text/markdown, text/plain, application/zip, */*' },
  })
  if (!response.ok) throw new Error(`skill fetch ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (isGzipBytes(bytes) || type.includes('gzip') || type.includes('x-tar') || type.includes('x-gtar')) {
    throw new Error('import SKILL.md, not an archive')
  }
  if (isZipBytes(bytes) || type.includes('zip')) {
    const extracted = extractZipSkill(bytes)
    if (!extracted) throw new Error('archive missing SKILL.md')
    return importSkillMarkdown({
      home: options?.home,
      url,
      markdown: extracted.markdown,
      scriptsPresent: extracted.scriptsPresent,
      now: options?.now,
    })
  }
  const markdown = new TextDecoder().decode(bytes)
  return importSkillMarkdown({
    home: options?.home,
    url,
    markdown,
    scriptsPresent: false,
    now: options?.now,
  })
}
