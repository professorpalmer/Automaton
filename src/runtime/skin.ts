import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { T } from '../tokens'
import { automatonHome } from './keys'

export type Skin = {
  railWidth: number
}

const DEFAULT_SKIN: Skin = {
  railWidth: T.layout.sidebarWidth,
}

export function skinPath(home = automatonHome()): string {
  return join(home, 'skin.json')
}

export function clampRailWidth(width: number): number {
  const n = Number.isFinite(width) ? width : T.layout.sidebarWidth
  return Math.round(Math.min(T.layout.sidebarMax, Math.max(T.layout.sidebarMin, n)))
}

export function railIsCompact(width: number): boolean {
  return clampRailWidth(width) <= T.layout.sidebarCompact
}

export function railDragOrigin(width: number): number {
  return clampRailWidth(width) + T.layout.railHandle / 2
}

export function railWidthFromDrag(startWidth: number, startX: number, x: number): number {
  if (!Number.isFinite(startWidth) || !Number.isFinite(startX) || !Number.isFinite(x)) {
    return clampRailWidth(startWidth)
  }
  return clampRailWidth(startWidth + (x - startX))
}

export function parseSkin(raw: unknown): Skin {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    railWidth: clampRailWidth(typeof row.railWidth === 'number' ? row.railWidth : T.layout.sidebarWidth),
  }
}

export function readSkin(home = automatonHome()): Skin {
  const path = skinPath(home)
  if (!existsSync(path)) return { ...DEFAULT_SKIN }
  try {
    return parseSkin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_SKIN }
  }
}

export function writeSkin(skin: Skin, home = automatonHome()): Skin {
  const next = parseSkin(skin)
  mkdirSync(home, { recursive: true })
  writeFileSync(skinPath(home), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function patchSkin(patch: Partial<Skin>, home = automatonHome()): Skin {
  return writeSkin({ ...readSkin(home), ...patch }, home)
}
