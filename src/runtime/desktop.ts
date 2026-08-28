import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopsRoot } from './computer'
import { automatonHome } from './keys'

export function desktopDir(agentId: string, home = automatonHome()): string {
  return join(desktopsRoot(home), agentId)
}

export function screenPath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'screen.png')
}

export function browserDir(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'browser')
}

export function boxChromeHostDir(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'box-chrome')
}

export function clearBoxProfileLocks(agentId: string, home = automatonHome()): void {
  const dir = boxChromeHostDir(agentId, home)
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      unlinkSync(join(dir, name))
    } catch {
      /* missing */
    }
  }
}

export function ensureDesktop(agentId: string, home = automatonHome()): string {
  const dir = desktopDir(agentId, home)
  mkdirSync(browserDir(agentId, home), { recursive: true })
  mkdirSync(boxChromeHostDir(agentId, home), { recursive: true })
  return dir
}

export function teardownDesktop(agentId: string, home = automatonHome()): void {
  const dir = desktopDir(agentId, home)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function desktopPreview(agentId: string, home = automatonHome()): {
  dir: string
  screen: string | null
} {
  const screen = screenPath(agentId, home)
  return {
    dir: desktopDir(agentId, home),
    screen: existsSync(screen) ? screen : null,
  }
}

export type DeskSurface = 'host' | 'box'
export type DeskViewport = { width: number; height: number }

export function surfacePath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'surface')
}

export function viewportPath(agentId: string, home = automatonHome()): string {
  return join(desktopDir(agentId, home), 'viewport.json')
}

export function readDeskSurface(agentId: string, home = automatonHome()): DeskSurface {
  try {
    const raw = readFileSync(surfacePath(agentId, home), 'utf8').trim()
    return raw === 'host' ? 'host' : 'box'
  } catch {
    return 'box'
  }
}

export function writeDeskSurface(agentId: string, surface: DeskSurface, home = automatonHome()): void {
  ensureDesktop(agentId, home)
  writeFileSync(surfacePath(agentId, home), `${surface}\n`)
}

export function readDeskViewport(agentId: string, home = automatonHome()): DeskViewport | null {
  try {
    const raw = JSON.parse(readFileSync(viewportPath(agentId, home), 'utf8')) as {
      width?: unknown
      height?: unknown
    }
    const width = typeof raw.width === 'number' ? raw.width : Number(raw.width)
    const height = typeof raw.height === 'number' ? raw.height : Number(raw.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return { width, height }
  } catch {
    return null
  }
}

export function writeDeskViewport(agentId: string, viewport: DeskViewport, home = automatonHome()): void {
  ensureDesktop(agentId, home)
  writeFileSync(viewportPath(agentId, home), `${JSON.stringify(viewport)}\n`)
}
