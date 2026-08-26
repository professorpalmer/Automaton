import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { browserDir, desktopDir, ensureDesktop, screenPath, teardownDesktop } from './desktop'
import { automatonHome } from './keys'

export type ChromeHandle = { pid: number; port: number }

export type ChromeSeams = {
  binary?: string | null
  spawn?: (bin: string, argv: string[]) => { pid: number }
  kill?: (pid: number) => void
  alive?: (pid: number) => boolean
  pickPort?: () => number | Promise<number>
  waitReady?: (port: number) => Promise<void>
  capturePng?: (port: number) => Promise<Uint8Array>
  navigate?: (port: number, url: string) => Promise<void>
}

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export function chromeBinary(seams?: ChromeSeams): string | null {
  if (seams && 'binary' in seams) return seams.binary ?? null
  if (process.env.AUTOMATON_CHROME_DISABLE === '1') return null
  if (process.env.BUN_TEST && !process.env.AUTOMATON_CHROME?.trim()) return null
  const override = process.env.AUTOMATON_CHROME?.trim()
  if (override) return existsSync(override) ? override : null
  for (const path of CANDIDATES) {
    if (existsSync(path)) return path
  }
  return null
}

export function chromeAvailable(seams?: ChromeSeams): boolean {
  return chromeBinary(seams) !== null
}

export function devtoolsPath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'devtools.json')
}

export function readHandle(agentId: string, home = automatonHome()): ChromeHandle | null {
  const path = devtoolsPath(agentId, home)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; port?: unknown }
    const pid = typeof raw.pid === 'number' ? raw.pid : Number(raw.pid)
    const port = typeof raw.port === 'number' ? raw.port : Number(raw.port)
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0) return null
    return { pid, port }
  } catch {
    return null
  }
}

function writeHandle(agentId: string, handle: ChromeHandle, home: string): void {
  writeFileSync(devtoolsPath(agentId, home), `${JSON.stringify({ port: handle.port, pid: handle.pid })}\n`)
}

function defaultAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function defaultKill(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
}

function defaultSpawn(bin: string, argv: string[]): { pid: number } {
  const child = spawn(bin, argv, { detached: true, stdio: 'ignore' })
  if (!child.pid) throw new Error('chrome spawn failed')
  child.unref()
  return { pid: child.pid }
}

function defaultPickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

async function defaultWaitReady(port: number): Promise<void> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('chrome debug port silent')
}

async function pageWs(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`chrome json/list ${response.status}`)
  const pages = (await response.json()) as { type?: string; webSocketDebuggerUrl?: string }[]
  const page = pages.find((row) => row.type === 'page' && row.webSocketDebuggerUrl) ?? pages[0]
  const url = page?.webSocketDebuggerUrl
  if (!url) throw new Error('no page target')
  return url
}

async function cdp(wsUrl: string, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = 1
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('cdp timeout'))
    }, 8000)
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data)
      try {
        const msg = JSON.parse(raw) as {
          id?: number
          result?: Record<string, unknown>
          error?: { message?: string }
        }
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.close()
        if (msg.error) reject(new Error(msg.error.message ?? 'cdp error'))
        else resolve(msg.result ?? {})
      } catch (error) {
        clearTimeout(timer)
        ws.close()
        reject(error)
      }
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('cdp socket'))
    })
  })
}

async function defaultCapturePng(port: number): Promise<Uint8Array> {
  const wsUrl = await pageWs(port)
  const result = await cdp(wsUrl, 'Page.captureScreenshot', { format: 'png' })
  const data = typeof result.data === 'string' ? result.data : ''
  if (!data) throw new Error('cdp screenshot empty')
  return Buffer.from(data, 'base64')
}

async function defaultNavigate(port: number, url: string): Promise<void> {
  const wsUrl = await pageWs(port)
  await cdp(wsUrl, 'Page.navigate', { url })
}

export async function ensureBrowser(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<ChromeHandle | null> {
  const bin = chromeBinary(seams)
  if (!bin) return null
  ensureDesktop(agentId, home)
  const alive = seams.alive ?? defaultAlive
  const existing = readHandle(agentId, home)
  if (existing && alive(existing.pid)) return existing
  const pick = seams.pickPort ?? defaultPickPort
  const port = await pick()
  const headed = process.env.AUTOMATON_CHROME_HEADED === '1'
  const argv = [
    `--user-data-dir=${browserDir(agentId, home)}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    ...(headed ? [] : ['--headless=new']),
    'about:blank',
  ]
  const spawnFn = seams.spawn ?? defaultSpawn
  const child = spawnFn(bin, argv)
  const handle = { pid: child.pid, port }
  writeHandle(agentId, handle, home)
  const wait = seams.waitReady ?? defaultWaitReady
  try {
    await wait(port)
  } catch {
    stopBrowser(agentId, home, seams)
    return null
  }
  return handle
}

export function stopBrowser(agentId: string, home = automatonHome(), seams: ChromeSeams = {}): void {
  const handle = readHandle(agentId, home)
  const path = devtoolsPath(agentId, home)
  if (handle) {
    const kill = seams.kill ?? defaultKill
    kill(handle.pid)
  }
  if (existsSync(path)) unlinkSync(path)
}

export async function captureScreen(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<string | null> {
  const handle = await ensureBrowser(agentId, home, seams)
  if (!handle) return null
  const capture = seams.capturePng ?? defaultCapturePng
  try {
    const bytes = await capture(handle.port)
    const dest = screenPath(agentId, home)
    writeFileSync(dest, bytes)
    return dest
  } catch {
    return null
  }
}

export async function browse(
  agentId: string,
  url: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<string | null> {
  const handle = await ensureBrowser(agentId, home, seams)
  if (!handle) return null
  const go = seams.navigate ?? defaultNavigate
  try {
    await go(handle.port, url)
  } catch {
    return null
  }
  return captureScreen(agentId, home, seams)
}

export function teardownBrowserDesktop(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): void {
  stopBrowser(agentId, home, seams)
  teardownDesktop(agentId, home)
}
