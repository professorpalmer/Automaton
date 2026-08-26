import { existsSync, mkdirSync, rmSync } from 'node:fs'
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

export function ensureDesktop(agentId: string, home = automatonHome()): string {
  const dir = desktopDir(agentId, home)
  mkdirSync(browserDir(agentId, home), { recursive: true })
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
