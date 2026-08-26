import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { automatonHome } from './keys'

export type AttachmentKind = 'image' | 'file'

export type Attachment = {
  id: string
  ownerAgentId: string
  itemId?: string
  path: string
  hash: string
  mime: string
  kind: AttachmentKind
}

export type AttachmentInput = {
  id: string
  ownerAgentId: string
  itemId?: string
  path: string
  hash: string
  mime: string
  kind: AttachmentKind
}

const IMAGE_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export function inboxDir(agentId: string, home = automatonHome()): string {
  return join(home, 'inbox', agentId)
}

export function safeName(name: string): string {
  const trimmed = basename(name).trim() || 'file'
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  return (cleaned || 'file').slice(0, 120)
}

export function classifyPath(path: string): { mime: string; kind: AttachmentKind } {
  const ext = extname(path).toLowerCase()
  const mime = IMAGE_EXT[ext]
  if (mime) return { mime, kind: 'image' }
  if (ext === '.pdf') return { mime: 'application/pdf', kind: 'file' }
  if (ext === '.json') return { mime: 'application/json', kind: 'file' }
  if (ext === '.md') return { mime: 'text/markdown', kind: 'file' }
  if (ext === '.txt') return { mime: 'text/plain', kind: 'file' }
  return { mime: 'application/octet-stream', kind: 'file' }
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function uniqueInboxPath(agentId: string, name: string, home = automatonHome()): string {
  const dir = inboxDir(agentId, home)
  mkdirSync(dir, { recursive: true })
  const safe = safeName(name)
  const ext = extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  let dest = join(dir, safe)
  let n = 1
  while (existsSync(dest)) {
    dest = join(dir, `${stem}-${n}${ext}`)
    n += 1
  }
  return dest
}

export function ingestPath(
  ownerAgentId: string,
  sourcePath: string,
  id: string,
  home = automatonHome(),
): Attachment {
  if (!existsSync(sourcePath)) throw new Error(`missing file ${sourcePath}`)
  const { mime, kind } = classifyPath(sourcePath)
  const dest = uniqueInboxPath(ownerAgentId, basename(sourcePath), home)
  copyFileSync(sourcePath, dest)
  return {
    id,
    ownerAgentId,
    path: dest,
    hash: hashFile(dest),
    mime,
    kind,
  }
}

export function imageDataUrl(path: string, mime: string): string {
  const bytes = readFileSync(path)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** Test seam first. Live Mac may open a native choose-file dialog. */
export function pickLocalFiles(): string[] {
  const fromEnv = (process.env.AUTOMATON_PICK_FILES ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  if (process.env.AUTOMATON_SILENT_PICK === '1') return []
  if (process.platform !== 'darwin') return []
  const result = Bun.spawnSync(['osascript', '-e', 'POSIX path of (choose file)'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) return []
  const path = result.stdout.toString().trim()
  return path ? [path] : []
}
