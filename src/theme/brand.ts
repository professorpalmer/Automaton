import { DEFAULT_TOKENS, type Tokens } from './tokens'

/** Bezel-style Brand knobs. Tint + accent + base radius; radii derive from the base. */
export type Brand = {
  tint: string
  accent: string
  radius: number
}

export const DEFAULT_BRAND: Brand = {
  tint: '#101010',
  accent: DEFAULT_TOKENS.accent,
  radius: DEFAULT_TOKENS.radius.control,
}

export const BRAND_RADIUS_MIN = 2
export const BRAND_RADIUS_MAX = 16

const HEX6 = /^#[0-9A-Fa-f]{6}$/

export function parseHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const hex = value.trim()
  return HEX6.test(hex) ? hex : fallback
}

export function clampBrandRadius(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_BRAND.radius
  return Math.round(Math.min(BRAND_RADIUS_MAX, Math.max(BRAND_RADIUS_MIN, n)))
}

export function parseBrand(raw: unknown): Brand {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    tint: parseHexColor(row.tint, DEFAULT_BRAND.tint),
    accent: parseHexColor(row.accent, DEFAULT_BRAND.accent),
    radius: clampBrandRadius(row.radius),
  }
}

/** control/button/panel/surface/bubble — Automaton names on the Bezel ladder. */
export function radiiFromBrand(brand: Brand): Tokens['radius'] {
  const control = clampBrandRadius(brand.radius)
  const button = control + 4
  const panel = control + 8
  const surface = control + 12
  const bubble = control + 2
  return {
    sm: control,
    md: button,
    lg: panel,
    xl: surface,
    badge: bubble,
    pill: 999,
    control,
    button,
    panel,
    surface,
    bubble,
  }
}

export const BRAND_TINT_SWATCHES = [
  { id: 'graphite', hex: DEFAULT_BRAND.tint },
  { id: 'ink', hex: DEFAULT_TOKENS.brand.ink },
  { id: 'black', hex: DEFAULT_TOKENS.catalog.black },
] as const

export const BRAND_ACCENT_SWATCHES = [
  { id: 'graphite', hex: DEFAULT_BRAND.accent },
  { id: 'violet', hex: DEFAULT_TOKENS.catalog.violet },
  { id: 'blue', hex: DEFAULT_TOKENS.catalog.blue },
  { id: 'green', hex: DEFAULT_TOKENS.catalog.green },
  { id: 'cyan', hex: DEFAULT_TOKENS.catalog.cyan },
  { id: 'orange', hex: DEFAULT_TOKENS.catalog.orange },
] as const

export const BRAND_RADIUS_PRESETS = [
  { id: 'tight', radius: 4 },
  { id: 'default', radius: DEFAULT_BRAND.radius },
  { id: 'soft', radius: 10 },
] as const
