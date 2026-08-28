import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { boxExec, boxStatus, type BoxSeams } from './box'
import { runningTests } from './test-env'
import { boxChromeAlive, boxChromeWindowReady, ensureScreen, fitBoxChrome, stopBoxChrome } from './screen'
import {
  BOX_CHROME,
  BOX_DISPLAY_H,
  BOX_DISPLAY_W,
  BOX_NAME,
  boxChromeDebugPort,
  boxProfileDir,
  mouthScreen,
} from './computer'
import { captchaOrigin, continueFromSorry, sorryPage } from './computer-tools'
import { captureDesk, captureDeskAsync, clickDesk, openDeskUrl, sendDeskStroke, uniqueDeskPaint, wheelDesk, type DeskStroke, type Point } from './desk'
import {
  browserDir,
  clearBoxProfileLocks,
  desktopDir,
  ensureDesktop,
  readDeskSurface,
  screenPath,
  teardownDesktop,
  writeDeskSurface,
  writeDeskViewport,
} from './desktop'
import { automatonHome } from './keys'

export function boxProfileLockRmArgv(agentId: string): string[] {
  const profile = boxProfileDir(agentId)
  return ['rm', '-f', `${profile}/SingletonLock`, `${profile}/SingletonSocket`, `${profile}/SingletonCookie`]
}

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
  /** Worker xdotool clicks stay on box Chrome. Interactive browse prefers host. */
  forceBox?: boolean
  /** When set, captcha origins ignore forceBox and use host Chrome. */
  url?: string
  pageInfo?: (port: number) => Promise<{ url: string; title: string } | null>
  clickPage?: (port: number, point: Point, button?: number) => Promise<boolean>
  keyPage?: (port: number, stroke: DeskStroke) => Promise<boolean>
  wheelPage?: (port: number, point: Point, deltaY: number) => Promise<boolean>
  viewport?: (port: number) => Promise<{ width: number; height: number } | null>
}

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export function chromeBinary(seams?: ChromeSeams): string | null {
  if (seams && 'binary' in seams) return seams.binary ?? null
  if (process.env.AUTOMATON_CHROME_DISABLE === '1') return null
  // bun test sets NODE_ENV=test, not BUN_TEST. A BUN_TEST-only gate spawned
  // detached Mac Chrome from shell tests (Take control → ensureBrowser).
  if (runningTests() && !process.env.AUTOMATON_CHROME?.trim()) return null
  const override = process.env.AUTOMATON_CHROME?.trim()
  if (override) return existsSync(override) ? override : null
  for (const path of CANDIDATES) {
    if (existsSync(path)) return path
  }
  return null
}

export function chromeAvailable(seams?: ChromeSeams, home = automatonHome()): boolean {
  return chromeMode(seams, home) !== 'none'
}

export function chromeMode(seams?: ChromeSeams, home = automatonHome()): 'box' | 'host' | 'none' {
  const captcha = Boolean(seams?.url && captchaOrigin(seams.url))
  if (seams?.forceBox && !captcha) return boxStatus(home, seams.box).running ? 'box' : 'none'
  if (chromeBinary(seams)) return 'host'
  if (boxStatus(home, seams?.box).running) return 'box'
  return 'none'
}

/** Host Google Chrome / helpers whose profile is an Automaton desktop dir. */
export function isAutomatonHostChromeCmd(cmd: string): boolean {
  return /--user-data-dir=\S*(?:automaton-shell-|[/\\]desktops[/\\][^/\\\s]+[/\\]browser)/.test(cmd)
}

export function listAutomatonHostChromePids(psText: string): number[] {
  const seen = new Set<number>()
  for (const line of psText.split('\n')) {
    if (!isAutomatonHostChromeCmd(line)) continue
    const pid = Number(line.trim().split(/\s+/)[0])
    if (Number.isInteger(pid) && pid > 1) seen.add(pid)
  }
  return [...seen]
}

function defaultPs(): string {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 8000,
  })
  return result.stdout ?? ''
}

/** SIGTERM then SIGKILL leaked Automaton host Chrome. Not the user's profile. */
export function sweepHostChrome(seams?: { ps?: () => string; kill?: (pid: number) => void }): number {
  const text = seams?.ps?.() ?? defaultPs()
  const pids = listAutomatonHostChromePids(text)
  const kill = seams?.kill ?? defaultKill
  for (const pid of pids) kill(pid)
  if (!seams?.kill) {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
  return pids.length
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
          '--disable-blink-features=AutomationControlled',
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

export function hostDevtoolsPath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'host-devtools.json')
}

function parseHandle(path: string): ChromeHandle | null {
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

export function readHandle(agentId: string, home = automatonHome()): ChromeHandle | null {
  return parseHandle(devtoolsPath(agentId, home))
}

export function readHostHandle(agentId: string, home = automatonHome()): ChromeHandle | null {
  const hosted = parseHandle(hostDevtoolsPath(agentId, home))
  if (hosted) return hosted
  const current = readHandle(agentId, home)
  return current?.via === 'host' ? current : null
}

function writeHandle(agentId: string, handle: ChromeHandle, home: string): void {
  const body = `${JSON.stringify(handle)}\n`
  writeFileSync(devtoolsPath(agentId, home), body)
  if (handle.via === 'host') writeFileSync(hostDevtoolsPath(agentId, home), body)
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
  const child = spawn(bin, argv, { stdio: 'ignore' })
  if (!child.pid) throw new Error('chrome spawn failed')
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

export async function defaultPageInfo(port: number): Promise<{ url: string; title: string } | null> {
  if (runningTests()) return null
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })
    if (!response.ok) return null
    const pages = (await response.json()) as { type?: string; url?: string; title?: string }[]
    const page = pages.find((row) => row.type === 'page') ?? pages[0]
    if (!page) return null
    return { url: page.url ?? '', title: page.title ?? '' }
  } catch {
    return null
  }
}

async function defaultViewport(port: number): Promise<{ width: number; height: number } | null> {
  try {
    const wsUrl = await pageWs(port)
    const result = await cdp(wsUrl, 'Page.getLayoutMetrics')
    const css = result.cssVisualViewport as { clientWidth?: number; clientHeight?: number } | undefined
    const width = Number(css?.clientWidth)
    const height = Number(css?.clientHeight)
    if (width > 1 && height > 1) return { width: Math.round(width), height: Math.round(height) }
  } catch {
    /* headed Chrome may still take a screenshot */
  }
  return null
}

function mouseButton(button?: number): 'left' | 'middle' | 'right' {
  if (button === 2) return 'right'
  if (button === 1) return 'middle'
  return 'left'
}

export async function clickPage(port: number, point: Point, button = 0): Promise<boolean> {
  try {
    const wsUrl = await pageWs(port)
    const btn = mouseButton(button)
    await cdp(wsUrl, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: btn,
      clickCount: 1,
    })
    await cdp(wsUrl, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: btn,
      clickCount: 1,
    })
    return true
  } catch {
    return false
  }
}

const HOST_KEYS: Record<string, string> = {
  Return: 'Enter',
  BackSpace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  Tab: 'Tab',
  space: ' ',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
}

export async function keyPage(port: number, stroke: DeskStroke): Promise<boolean> {
  try {
    const wsUrl = await pageWs(port)
    if (stroke.via === 'type') {
      await cdp(wsUrl, 'Input.insertText', { text: stroke.value })
      return true
    }
    const parts = stroke.value.split('+')
    const base = parts.at(-1) ?? ''
    let modifiers = 0
    if (parts.includes('alt')) modifiers |= 1
    if (parts.includes('ctrl')) modifiers |= 2
    if (parts.includes('meta') || parts.includes('cmd')) modifiers |= 4
    if (parts.includes('shift')) modifiers |= 8
    const key = HOST_KEYS[base] ?? base
    await cdp(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers })
    await cdp(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers })
    return true
  } catch {
    return false
  }
}

export async function wheelPage(port: number, point: Point, deltaY: number): Promise<boolean> {
  if (!deltaY) return false
  try {
    const wsUrl = await pageWs(port)
    await cdp(wsUrl, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY,
    })
    return true
  } catch {
    return false
  }
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
    if (existing && existing.port === wantedPort && boxChromeWindowReady(agentId, home, seams.box)) {
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
  if (mode === 'box') {
    boxExec(boxProfileLockRmArgv(agentId), {}, seams.box)
    clearBoxProfileLocks(agentId, home)
  }
  if (mode === 'host') {
    const hosted = readHostHandle(agentId, home)
    if (hosted && alive(hosted.pid)) {
      try {
        await (seams.waitReady ?? defaultWaitReady)(hosted.port)
      } catch {
        /* CDP click can still wait */
      }
      writeHandle(agentId, hosted, home)
      return hosted
    }
  }
  const pick = seams.pickPort ?? defaultPickPort
  const port = mode === 'box' ? wantedPort : await pick()
  const launch = chromeLaunch({
    agentId,
    port,
    mode,
    home,
    hostBin: mode === 'host' ? chromeBinary(seams) ?? undefined : undefined,
    headed: mode === 'host' ? !runningTests() : undefined,
  })
  const spawnFn = seams.spawn ?? defaultSpawn
  const child = spawnFn(launch.bin, launch.argv)
  const handle: ChromeHandle = { pid: child.pid, port, display: launch.display, via: mode }
  writeHandle(agentId, handle, home)
  if (mode === 'box') {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (boxChromeAlive(agentId, home, seams.box) && boxChromeWindowReady(agentId, home, seams.box)) {
        fitBoxChrome(agentId, home, seams.box)
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
    const hostPath = hostDevtoolsPath(agentId, home)
    if (existsSync(hostPath)) unlinkSync(hostPath)
  }
  if (existsSync(path)) unlinkSync(path)
}

function rememberViewport(agentId: string, home: string, bytes: Uint8Array, view: { width: number; height: number } | null): void {
  if (view && view.width > 1 && view.height > 1) {
    writeDeskViewport(agentId, view, home)
    return
  }
  if (bytes.length >= 24) {
    const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!
    const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!
    if (width > 8 && height > 8) {
      writeDeskViewport(agentId, { width, height }, home)
      return
    }
  }
  writeDeskViewport(agentId, { width: BOX_DISPLAY_W, height: BOX_DISPLAY_H }, home)
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
    const view = seams.viewport
      ? await seams.viewport(handle.port)
      : runningTests()
        ? null
        : await defaultViewport(handle.port)
    rememberViewport(agentId, home, bytes, view)
    return dest
  } catch {
    return null
  }
}

/** Bring Automaton host Chrome forward so a captcha solve lands on this profile. */
export function focusHostChrome(pid: number): boolean {
  if (runningTests() || process.platform !== 'darwin' || pid <= 1) return false
  const result = spawnSync(
    'osascript',
    [
      '-e',
      `tell application "System Events" to set frontmost of (first process whose unix id is ${Math.floor(pid)}) to true`,
    ],
    { encoding: 'utf8', timeout: 8000 },
  )
  return result.status === 0
}

export async function browse(
  agentId: string,
  url: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<string | null> {
  const effective: ChromeSeams = { ...seams, url }
  const mode = chromeMode(effective, home)
  const handle = await ensureBrowser(agentId, home, effective)
  if (!handle) return null
  if (!(await goToUrl(mode, handle.port, agentId, url, home, effective))) return null
  if (mode === 'host') {
    writeDeskSurface(agentId, 'host', home)
    focusHostChrome(handle.pid)
    return captureScreen(agentId, home, effective)
  }
  writeDeskSurface(agentId, 'box', home)
  const info = await (effective.pageInfo ?? defaultPageInfo)(handle.port)
  if (info && sorryPage(info.url, info.title) && chromeBinary(effective)) {
    const next = continueFromSorry(info.url, url)
    return browse(agentId, next, home, { ...seams, forceBox: false })
  }
  return captureScreen(agentId, home, effective)
}

function hostPort(agentId: string, home: string): number | null {
  const handle = readHostHandle(agentId, home) ?? readHandle(agentId, home)
  if (!handle || handle.port <= 0 || handle.via === 'box') return null
  return handle.port
}

export async function captureAgentDesk(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): Promise<string | null> {
  if (readDeskSurface(agentId, home) === 'host') {
    const path = await captureScreen(agentId, home, { ...seams, forceBox: false })
    return path ? uniqueDeskPaint(agentId, path, home) : null
  }
  return captureDesk(agentId, home, { box: seams.box })
}

export function captureAgentDeskAsync(
  agentId: string,
  done: (path: string | null) => void,
  home = automatonHome(),
  seams: ChromeSeams = {},
): void {
  if (readDeskSurface(agentId, home) === 'host') {
    void captureAgentDesk(agentId, home, seams).then(done)
    return
  }
  captureDeskAsync(agentId, done, home, { box: seams.box })
}

export function clickAgentDesk(
  agentId: string,
  point: Point,
  button = 0,
  home = automatonHome(),
  seams: ChromeSeams = {},
): boolean {
  if (readDeskSurface(agentId, home) !== 'host') {
    return clickDesk(agentId, point, button, home, { box: seams.box })
  }
  const port = hostPort(agentId, home)
  if (!port) return false
  void (seams.clickPage ?? clickPage)(port, point, button)
  return true
}

export function sendAgentStroke(
  agentId: string,
  stroke: DeskStroke,
  home = automatonHome(),
  seams: ChromeSeams = {},
): boolean {
  if (readDeskSurface(agentId, home) !== 'host') {
    return sendDeskStroke(agentId, stroke, home, { box: seams.box })
  }
  const port = hostPort(agentId, home)
  if (!port) return false
  void (seams.keyPage ?? keyPage)(port, stroke)
  return true
}

export function keyAgentDesk(
  agentId: string,
  key: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): boolean {
  return sendAgentStroke(agentId, { via: 'key', value: key }, home, seams)
}

export function wheelAgentDesk(
  agentId: string,
  point: Point,
  deltaY: number,
  home = automatonHome(),
  seams: ChromeSeams = {},
): boolean {
  if (readDeskSurface(agentId, home) !== 'host') {
    return wheelDesk(agentId, point, deltaY, home, { box: seams.box })
  }
  const port = hostPort(agentId, home)
  if (!port) return false
  void (seams.wheelPage ?? wheelPage)(port, point, deltaY)
  return true
}

export function hostDeskSeams(agentId: string, home = automatonHome()): ChromeSeams {
  return readDeskSurface(agentId, home) === 'host' ? {} : { forceBox: true }
}

export function teardownBrowserDesktop(
  agentId: string,
  home = automatonHome(),
  seams: ChromeSeams = {},
): void {
  stopBrowser(agentId, home, seams)
  teardownDesktop(agentId, home)
}
