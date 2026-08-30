import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { T } from '../tokens'
import { automatonHome } from './keys'

export type WindowMode = 'frosted' | 'solid'

export type Skin = {
  railWidth: number
  windowMode: WindowMode
  frostWash: number
}

export const DEFAULT_FROST_WASH = 12

const DEFAULT_SKIN: Skin = {
  railWidth: T.layout.sidebarWidth,
  windowMode: 'frosted',
  frostWash: DEFAULT_FROST_WASH,
}

export function skinPath(home = automatonHome()): string {
  return join(home, 'skin.json')
}

export function clampRailWidth(width: number): number {
  const n = Number.isFinite(width) ? width : T.layout.sidebarWidth
  return Math.round(Math.min(T.layout.sidebarMax, Math.max(T.layout.sidebarMin, n)))
}

export function clampFrostWash(value: number): number {
  const n = Number.isFinite(value) ? value : DEFAULT_FROST_WASH
  return Math.round(Math.min(100, Math.max(0, n)))
}

export function parseWindowMode(value: unknown): WindowMode {
  return value === 'solid' ? 'solid' : 'frosted'
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
    windowMode: parseWindowMode(row.windowMode),
    frostWash: clampFrostWash(typeof row.frostWash === 'number' ? row.frostWash : DEFAULT_FROST_WASH),
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
  writeFileSync(skinPath(home), `${JSON.stringify(next, null, 2)}
`)
  return next
}

export function patchSkin(patch: Partial<Skin>, home = automatonHome()): Skin {
  return writeSkin({ ...readSkin(home), ...patch }, home)
}

function washHex(rgb: string, wash: number): string {
  const hex = rgb.replace('#', '').slice(0, 6)
  const a = Math.round((clampFrostWash(wash) / 100) * 72)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `#${hex}${a}`
}

export function chromeFromSkin(skin: Skin): {
  canvas: string
  sidebar: string
  composer: string
  raised: string
  selected: string
  secondary: string
  tertiary: string
  ghost: string
  windowBackground: 'blurred' | 'opaque'
} {
  if (skin.windowMode === 'solid') {
    return {
      canvas: '#141414',
      sidebar: '#181818',
      composer: '#1C1C1C',
      raised: '#222222',
      selected: '#2A2A2A',
      secondary: '#B4B4B4',
      tertiary: '#8A8A8A',
      ghost: '#5A5A5A',
      windowBackground: 'opaque',
    }
  }
  return {
    canvas: washHex('#101010', skin.frostWash),
    sidebar: '#FFFFFF0A',
    composer: '#FFFFFF38',
    raised: '#FFFFFF0D',
    selected: '#FFFFFF1A',
    secondary: '#F2F2F2',
    tertiary: '#E8E8E8',
    ghost: '#D8D8D8',
    windowBackground: 'blurred',
  }
}

export function applyChromeToTokens(skin: Skin = readSkin()): typeof T {
  const chrome = chromeFromSkin(skin)
  T.canvas = chrome.canvas
  T.sidebar = chrome.sidebar
  T.composer = chrome.composer
  T.raised = chrome.raised
  T.selected = chrome.selected
  T.secondary = chrome.secondary
  T.tertiary = chrome.tertiary
  T.ghost = chrome.ghost
  return T
}
