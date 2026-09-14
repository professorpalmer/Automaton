import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LIGHT_CANVAS,
  LIGHT_RAISED,
  LIGHT_ROLES,
  LIGHT_SIDEBAR,
  accentForAppearance,
  parseAppearance,
  type Appearance,
} from '../theme/appearance'
import { DEFAULT_BRAND, parseBrand, type Brand } from '../theme/brand'
import { DEFAULT_TOKENS } from '../theme/tokens'
import { automatonHome } from './keys'

export type WindowMode = 'frosted' | 'solid'

export type Skin = {
  railWidth: number
  windowMode: WindowMode
  frostWash: number
  appearance: Appearance
  brand: Brand
}

export const DEFAULT_FROST_WASH = 12

const DEFAULT_SKIN: Skin = {
  railWidth: DEFAULT_TOKENS.layout.sidebarWidth,
  windowMode: 'frosted',
  frostWash: DEFAULT_FROST_WASH,
  appearance: 'dark',
  brand: { ...DEFAULT_BRAND },
}

export function skinPath(home = automatonHome()): string {
  return join(home, 'skin.json')
}

export function clampRailWidth(width: number): number {
  const n = Number.isFinite(width) ? width : DEFAULT_TOKENS.layout.sidebarWidth
  return Math.round(Math.min(DEFAULT_TOKENS.layout.sidebarMax, Math.max(DEFAULT_TOKENS.layout.sidebarMin, n)))
}

export function clampFrostWash(value: number): number {
  const n = Number.isFinite(value) ? value : DEFAULT_FROST_WASH
  return Math.round(Math.min(100, Math.max(0, n)))
}

export function parseWindowMode(value: unknown): WindowMode {
  return value === 'solid' ? 'solid' : 'frosted'
}

export function railIsCompact(width: number): boolean {
  return clampRailWidth(width) <= DEFAULT_TOKENS.layout.sidebarCompact
}

/** Compact ↔ default width. Drag still owns fine control. */
export function toggleRailWidth(width: number): number {
  const current = clampRailWidth(width)
  if (railIsCompact(current)) return DEFAULT_TOKENS.layout.sidebarWidth
  return DEFAULT_TOKENS.layout.sidebarMin
}

export function railDragOrigin(width: number): number {
  return clampRailWidth(width) + DEFAULT_TOKENS.layout.railHandle / 2
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
    railWidth: clampRailWidth(typeof row.railWidth === 'number' ? row.railWidth : DEFAULT_TOKENS.layout.sidebarWidth),
    windowMode: parseWindowMode(row.windowMode),
    frostWash: clampFrostWash(typeof row.frostWash === 'number' ? row.frostWash : DEFAULT_FROST_WASH),
    appearance: parseAppearance(row.appearance),
    brand: parseBrand(row.brand),
  }
}

export function readSkin(home = automatonHome()): Skin {
  const path = skinPath(home)
  if (!existsSync(path)) return { ...DEFAULT_SKIN, brand: { ...DEFAULT_BRAND } }
  try {
    return parseSkin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_SKIN, brand: { ...DEFAULT_BRAND } }
  }
}

export function writeSkin(skin: Skin | Partial<Skin>, home = automatonHome()): Skin {
  const next = parseSkin(skin)
  mkdirSync(home, { recursive: true })
  writeFileSync(
    skinPath(home),
    `${JSON.stringify(next, null, 2)}
`,
  )
  return next
}

export function patchSkin(patch: Partial<Skin>, home = automatonHome()): Skin {
  const current = readSkin(home)
  return writeSkin(
    {
      ...current,
      ...patch,
      brand: patch.brand ? parseBrand({ ...current.brand, ...patch.brand }) : current.brand,
    },
    home,
  )
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
  accent: string
  windowBackground: 'blurred' | 'opaque'
} {
  const appearance = parseAppearance(skin.appearance)
  const accent = accentForAppearance(skin.brand.accent, appearance)
  if (appearance === 'light') {
    const roles = LIGHT_ROLES
    if (skin.windowMode === 'solid') {
      return {
        canvas: LIGHT_CANVAS,
        sidebar: LIGHT_SIDEBAR,
        composer: LIGHT_CANVAS,
        raised: LIGHT_RAISED,
        selected: '#0000000F',
        secondary: roles.secondary,
        tertiary: roles.tertiary,
        ghost: roles.ghost,
        accent,
        windowBackground: 'opaque',
      }
    }
    return {
      canvas: washHex(skin.brand.tint, skin.frostWash),
      sidebar: '#0000000A',
      composer: LIGHT_CANVAS,
      raised: LIGHT_RAISED,
      selected: '#0000000F',
      secondary: roles.secondary,
      tertiary: roles.tertiary,
      ghost: roles.ghost,
      accent,
      windowBackground: 'blurred',
    }
  }
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
      accent,
      windowBackground: 'opaque',
    }
  }
  return {
    canvas: washHex(skin.brand.tint, skin.frostWash),
    sidebar: '#FFFFFF0A',
    composer: '#FFFFFF38',
    raised: '#FFFFFF0D',
    selected: '#FFFFFF1A',
    secondary: '#F2F2F2',
    tertiary: '#E8E8E8',
    ghost: '#D8D8D8',
    accent,
    windowBackground: 'blurred',
  }
}
