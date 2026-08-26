import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { automatonHome } from './keys'
import { runningTests } from './test-env'

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
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
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

/**
 * Hosted NSOpenPanel. Bare `choose file` from osascript paints inactive chrome
 * until the user clicks the panel.
 */
export const CHOOSE_FILE_SCRIPT = `ObjC.import('AppKit')
function run() {
  const app = $.NSApplication.sharedApplication
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory)
  app.activateIgnoringOtherApps(true)
  const panel = $.NSOpenPanel.openPanel
  panel.setCanChooseFiles(true)
  panel.setCanChooseDirectories(false)
  panel.setAllowsMultipleSelection(false)
  panel.setFloatingPanel(true)
  const result = panel.runModal
  if (Number(result) !== Number($.NSModalResponseOK)) return ''
  const urls = panel.URLs
  if (Number(urls.count) < 1) return ''
  return ObjC.unwrap(urls.objectAtIndex(0).path)
}
`

export type PickSeams = {
  env?: NodeJS.Dict<string>
  bunTest?: boolean
  platform?: string
  run?: (script: string) => { ok: boolean; stdout: string }
}

function runChooseFile(script: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(['osascript', '-l', 'JavaScript', '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim() }
}

/** Test seam first. Live Mac may open a native choose-file dialog. */
export function pickLocalFiles(seams?: PickSeams): string[] {
  const env = seams?.env ?? process.env
  const fromEnv = (env.AUTOMATON_PICK_FILES ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  if (env.AUTOMATON_SILENT_PICK === '1') return []
  const bunTest = seams?.bunTest ?? runningTests()
  if (bunTest) return []
  const platform = seams?.platform ?? process.platform
  if (platform !== 'darwin') return []
  const result = (seams?.run ?? runChooseFile)(CHOOSE_FILE_SCRIPT)
  if (!result.ok) return []
  const path = result.stdout.trim()
  return path ? [path] : []
}

export type ClipRun = (script: string) => { ok: boolean; stdout: string }

export type ClipSeams = {
  platform?: string
  env?: NodeJS.Dict<string>
  bunTest?: boolean
  tmp?: string
  now?: () => number
  run?: ClipRun
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
}

function applePath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function runOsascript(script: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(['osascript', '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim() }
}

function looksLikePng(path: string): boolean {
  if (!existsSync(path)) return false
  const bytes = readFileSync(path)
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)
}

function looksLikeTiff(path: string): boolean {
  if (!existsSync(path)) return false
  const bytes = readFileSync(path)
  if (bytes.length < 4) return false
  return (
    (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)
  )
}

function looksLikeJpeg(path: string): boolean {
  if (!existsSync(path)) return false
  const bytes = readFileSync(path)
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function writeClass(script: string, dest: string, check: (path: string) => boolean, run: ClipRun): string | null {
  mkdirSync(dirname(dest), { recursive: true })
  const result = run(script)
  if (!result.ok || result.stdout === 'no' || !check(dest)) {
    if (existsSync(dest)) {
      try {
        unlinkSync(dest)
      } catch {}
    }
    return null
  }
  return dest
}

function binaryScript(dest: string, asExpr: string): string {
  const file = applePath(dest)
  return `set dest to POSIX file "${file}"
try
  set blob to (${asExpr})
  set fh to open for access dest with write permission
  set eof of fh to 0
  write blob to fh
  close access fh
  return "ok"
on error
  try
    close access dest
  end try
  return "no"
end try`
}

const FILE_SCRIPT = `set out to ""
try
  set theFiles to the clipboard as list of alias
  repeat with f in theFiles
    set out to out & (POSIX path of f) & linefeed
  end repeat
  return out
on error
  try
    return POSIX path of (the clipboard as alias)
  on error
    return ""
  end try
end try`

function clipLooksLike(info: string, token: string): boolean {
  return info.toLowerCase().includes(token)
}

function clipLooksLikeText(info: string): boolean {
  const lower = info.toLowerCase()
  return (
    lower.includes('utf8') ||
    lower.includes('ut16') ||
    lower.includes('unicode text') ||
    /(^|[,\s])string([,\s]|$)/.test(lower)
  )
}

function clipLooksLikeBitmap(info: string): boolean {
  const lower = info.toLowerCase()
  return lower.includes('pngf') || lower.includes('jpeg')
}

function clipLooksLikeFiles(info: string): boolean {
  const lower = info.toLowerCase()
  if (
    clipLooksLikeText(lower) &&
    !clipLooksLikeBitmap(lower) &&
    !lower.includes('alias') &&
    !lower.includes('furl')
  ) {
    return false
  }
  return (
    lower.includes('pngf') ||
    lower.includes('tiff') ||
    lower.includes('jpeg') ||
    lower.includes('alias') ||
    lower.includes('furl')
  )
}

/** Screenshot / copied files. Text-only and text+TIFF previews stay out of the inbox. */
export function readClipboardPaths(seams?: ClipSeams): string[] {
  const env = seams?.env ?? process.env
  const listed = envList(env.AUTOMATON_CLIP_FILES)
  if (listed.length > 0) return listed
  if (env.AUTOMATON_SILENT_CLIP === '1') return []
  const bunTest = seams?.bunTest ?? runningTests()
  if (bunTest) return []
  const platform = seams?.platform ?? process.platform
  if (platform !== 'darwin') return []
  const run = seams?.run ?? runOsascript
  const info = run('clipboard info')
  if (info.ok && info.stdout && !clipLooksLikeFiles(info.stdout)) return []
  const tryPng = !info.ok || !info.stdout || clipLooksLike(info.stdout, 'pngf')
  const tryTiff = !info.ok || !info.stdout || clipLooksLike(info.stdout, 'tiff')
  const tryJpeg = !info.ok || !info.stdout || clipLooksLike(info.stdout, 'jpeg')
  const tryFiles =
    !info.ok || !info.stdout || clipLooksLike(info.stdout, 'alias') || clipLooksLike(info.stdout, 'furl')
  const tmp = seams?.tmp ?? tmpdir()
  const now = seams?.now ?? Date.now
  mkdirSync(tmp, { recursive: true })
  const stamp = now()
  if (tryPng) {
    const dest = join(tmp, `automaton-clip-${stamp}.png`)
    const png = writeClass(binaryScript(dest, 'the clipboard as «class PNGf»'), dest, looksLikePng, run)
    if (png) return [png]
  }
  if (tryTiff) {
    const dest = join(tmp, `automaton-clip-${stamp}.tiff`)
    const tiff = writeClass(binaryScript(dest, 'the clipboard as «class TIFF»'), dest, looksLikeTiff, run)
    if (tiff) return [tiff]
  }
  if (tryJpeg) {
    const dest = join(tmp, `automaton-clip-${stamp}.jpg`)
    const jpeg = writeClass(binaryScript(dest, 'the clipboard as JPEG picture'), dest, looksLikeJpeg, run)
    if (jpeg) return [jpeg]
  }
  if (!tryFiles) return []
  const files = run(FILE_SCRIPT)
  if (!files.ok || !files.stdout) return []
  return files.stdout
    .split('\n')
    .map((row) => row.trim())
    .filter((path) => path && existsSync(path))
}

function runPbpaste(): string {
  const result = Bun.spawnSync(['pbpaste'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return result.exitCode === 0 ? result.stdout.toString() : ''
}

/** Plain text from the pasteboard. File/image flavors win in readClipboardPaths. */
export function readClipboardText(seams?: ClipSeams): string {
  const env = seams?.env ?? process.env
  if (Object.prototype.hasOwnProperty.call(env, 'AUTOMATON_CLIP_TEXT')) return String(env.AUTOMATON_CLIP_TEXT ?? '')
  if (env.AUTOMATON_SILENT_CLIP === '1') return ''
  const bunTest = seams?.bunTest ?? runningTests()
  if (bunTest) return ''
  const platform = seams?.platform ?? process.platform
  if (platform !== 'darwin') return ''
  if (seams?.run) {
    const result = seams.run('the clipboard as string')
    return result.ok ? result.stdout : ''
  }
  return runPbpaste()
}

export function insertClipboardText(draft: string, text: string): string {
  if (!text) return draft
  if (draft.endsWith(text)) return draft
  return `${draft}${text}`
}
