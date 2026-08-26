import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { boxStatus, type BoxSeams } from './box'
import { boxChromeAlive, boxChromeWindowReady, ensureScreen, fitBoxChrome, stopBoxChrome } from './screen'
import {
  BOX_CHROME,
  BOX_NAME,
  boxChromeDebugPort,
  boxProfileDir,
  mouthScreen,
} from './computer'
import { browserDir, desktopDir, ensureDesktop, screenPath, teardownDesktop, boxChromeHostDir } from './desktop'
import { captureDesk, openDeskUrl } from './desk'
import { automatonHome } from './keys'

export type ChromeHandle = { pid: number; port: number; display?: number; via?: 'box' | 'host' }

export type ChromeSeams = {
  binary?: string | null
  spawn?: (bin: string, argv: string[]) => { pid: number }
  kill?: (pid: number) => void
  alive?: (pid: number) => boolean
  pickPort?: () => number | Promise<number>
  waitReady?: (port: number) => Promise<void>
  capturePng?: (port: number) => Promise<Uint8Array>
  navigate?: (port: number, url: string) => Promise<void>
  box?: BoxSeams
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
  if (chromeBinary(seams) !== null) return true
  if (seams && 'binary' in seams) return false
  return boxStatus(automatonHome(), seams?.box).running
}

export function chromeMode(seams?: ChromeSeams, home = automatonHome()): 'box' | 'host' | 'none' {
  if (seams && 'binary' in seams) return seams.binary ? 'host' : 'none'
  if (boxStatus(home, seams?.box).running) return 'box'
  return chromeBinary(seams) ? 'host' : 'none'
}

export function chromeLaunch(input: {
  agentId: string
  port: number
  mode: 'box' | 'host'
  home?: string
  hostBin?: string
  headed?: boolean
}): { bin: string; argv: string[]; display: number } {
  const home = input.home ?? automatonHome()
  const screen = mouthScreen(input.agentId, home)
  const headed =
    input.mode === 'box' || input.headed === true || process.env.AUTOMATON_CHROME_HEADED === '1'
  const flags = [
    `--remote-debugging-port=${input.port}`,
    `--remote-debugging-address=${input.mode === 'box' ? '0.0.0.0' : '127.0.0.1'}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    ...(headed ? [] : ['--headless=new']),
    ...(input.mode === 'box'
      ? [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-infobars',
          '--test-type',
          '--start-maximized',
        ]
      : []),
    'about:blank',
  ]
  if (input.mode === 'box') {
    const profile = boxProfileDir(input.agentId)
    return {
      bin: 'docker',
      display: screen.display,
      argv: [
        'exec',
        '-d',
        '-e',
        `DISPLAY=:${screen.display}`,
        BOX_NAME,
        BOX_CHROME,
        `--user-data-dir=${profile}`,
        ...flags,
      ],
    }
  }
  const bin = input.hostBin ?? chromeBinary() ?? 'chrome'
  return {
    bin,
    display: screen.display,
    argv: [`--user-data-dir=${browserDir(input.agentId, home)}`, ...flags],
  }
}

export function devtoolsPath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'devtools.json')
}

export function readHandle(agentId: string, home = automatonHome()): ChromeHandle | null {
  const path = devtoolsPath(agentId, home)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      pid?: unknown
      port?: unknown
      display?: unknown
      via?: unknown
    }
    const pid = typeof raw.pid === 'number' ? raw.pid : Number(raw.pid)
    const port = typeof raw.port === 'number' ? raw.port : Number(raw.port)
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0) return null
    const display = typeof raw.display === 'number' ? raw.display : undefined
    const via = raw.via === 'box' || raw.via === 'host' ? raw.via : undefined
    return { pid, port, display, via }
  } catch {
    return null
  }
}

function writeHandle(agentId: string, handle: ChromeHandle, home: string): void {
  writeFileSync(devtoolsPath(agentId, home), `${JSON.stringify(handle)}\n`)
}

function clearBoxProfileLocks(agentId: string, home: string): void {
  const dir = boxChromeHostDir(agentId, home)
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const path = join(dir, name)
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      /* dangling symlink */
    }
  }
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

export async function goToUrl(
  mode: 'box' | 'host',
  port: number,
  agentId: string,
  url: string,
  home: string,
  seams: ChromeSeams,
): Promise<boolean> {
  const go = seams.navigate ?? defaultNavigate
  try {
    await go(port, url)
    return true
  } catch {
    if (mode !== 'box') return false
    return openDeskUrl(agentId, url, home, { box: seams.box })
  }
}

export async function ensureBrowser(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<ChromeHandle | null> {
  const mode = chromeMode(seams, home)
  if (mode === 'none') return null
  ensureDesktop(agentId, home)
  if (mode === 'box') ensureScreen(agentId, home, seams.box)
  const alive = seams.alive ?? defaultAlive
  const existing = readHandle(agentId, home)
  const wantedPort = mode === 'box' ? boxChromeDebugPort(mouthScreen(agentId, home).display) : 0
  if (mode === 'box' && boxChromeAlive(agentId, home, seams.box)) {
    if (existing && existing.port === wantedPort) {
      fitBoxChrome(agentId, home, seams.box)
      try {
        await (seams.waitReady ?? defaultWaitReady)(existing.port)
      } catch {
        /* xdotool can still type the URL */
      }
      return existing
    }
    stopBoxChrome(agentId, home, seams.box)
  }
  if (mode === 'box') clearBoxProfileLocks(agentId, home)
  if (existing && alive(existing.pid) && existing.via !== 'box') return existing
  const pick = seams.pickPort ?? defaultPickPort
  const port = mode === 'box' ? wantedPort : await pick()
  const launch = chromeLaunch({
    agentId,
    port,
    mode,
    home,
    hostBin: mode === 'host' ? chromeBinary(seams) ?? undefined : undefined,
  })
  const spawnFn = seams.spawn ?? defaultSpawn
  const child = spawnFn(launch.bin, launch.argv)
  const handle: ChromeHandle = { pid: child.pid, port, display: launch.display, via: mode }
  writeHandle(agentId, handle, home)
  if (mode === 'box') {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (boxChromeAlive(agentId, home, seams.box)) {
        if (boxChromeWindowReady(agentId, home, seams.box)) fitBoxChrome(agentId, home, seams.box)
        try {
          await (seams.waitReady ?? defaultWaitReady)(handle.port)
        } catch {
          /* headed Chrome can still take xdotool */
        }
        return handle
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    stopBrowser(agentId, home, seams)
    return null
  }
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
  if (handle?.via === 'box' || (!handle && chromeMode(seams, home) === 'box')) {
    stopBoxChrome(agentId, home, seams.box)
  } else if (handle) {
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
  if (chromeMode(seams, home) === 'box') {
    await ensureBrowser(agentId, home, seams)
    return captureDesk(agentId, home, { box: seams.box })
  }
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
  const mode = chromeMode(seams, home)
  const handle = await ensureBrowser(agentId, home, seams)
  if (!handle) return null
  if (!(await goToUrl(mode, handle.port, agentId, url, home, seams))) return null
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
