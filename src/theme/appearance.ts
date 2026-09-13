/** Designed light + dark roles. Light is not an invert of the graphite snapshot. */

export type Appearance = 'dark' | 'light'

export const DEFAULT_APPEARANCE: Appearance = 'dark'

/** Bezel light frost tone — grey(235), a paper sheet, not inverted #101010. */
export const LIGHT_PAPER_TINT = '#EBEBEB'

/** Content plane in solid light. Long-form reads on unbroken white. */
export const LIGHT_CANVAS = '#FFFFFF'

/** Chrome recedes by going grey — invert would lighten it instead. */
export const LIGHT_SIDEBAR = '#F7F7F7'

/** Raised plates are a real grey so user bubbles do not vanish into white. */
export const LIGHT_RAISED = '#F0F0F0'

/** Ink text ~0.25 lightness — paired ~16:1 on white, not harsh #000. */
export const LIGHT_TEXT = '#404040'

const HEX6 = /^#[0-9A-Fa-f]{6}$/

export function parseAppearance(value: unknown): Appearance {
  return value === 'light' ? 'light' : 'dark'
}

function hexRgb(hex: string): [number, number, number] | null {
  const raw = hex.trim()
  if (!HEX6.test(raw)) return null
  const n = parseInt(raw.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const rgb = hexRgb(hex)
  if (!rgb) return 0
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a: string, b: string): number {
  const left = relativeLuminance(a)
  const right = relativeLuminance(b)
  const [hi, lo] = left > right ? [left, right] : [right, left]
  return (hi + 0.05) / (lo + 0.05)
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

export function mixHex(a: string, b: string, t: number): string {
  const left = hexRgb(a)
  const right = hexRgb(b)
  if (!left || !right) return a
  const u = Math.max(0, Math.min(1, t))
  return toHex(
    left[0] * (1 - u) + right[0] * u,
    left[1] * (1 - u) + right[1] * u,
    left[2] * (1 - u) + right[2] * u,
  )
}

function contrastFloor(appearance: Appearance): string {
  return appearance === 'light' ? LIGHT_CANVAS : '#101010'
}

/**
 * Keep Brand hue; walk toward ink/paper until the swatch clears AA on the
 * appearance's content plane. Graphite #D4D4D4 on white is the usual miss.
 */
export function accentForAppearance(hex: string, appearance: Appearance, floor = 4.5): string {
  const color = HEX6.test(hex.trim()) ? hex.trim() : '#D4D4D4'
  const bg = contrastFloor(appearance)
  if (contrastRatio(color, bg) >= floor) return color
  const toward = appearance === 'light' ? '#1A1A1A' : '#F2F2F2'
  let next = color
  for (let step = 1; step <= 20; step += 1) {
    next = mixHex(color, toward, step / 20)
    if (contrastRatio(next, bg) >= floor) return next
  }
  return toward
}

export type AppearanceRoles = {
  text: string
  secondary: string
  tertiary: string
  ghost: string
  inverse: string
  onInverse: string
  border: string
  borderStrong: string
  sidebarBorder: string
  overlay: string
  overlayStrong: string
  menu: string
  menuHover: string
  scrim: string
  danger: string
  deskHit: string
}

/** Role assignment, not a lightness flip. Dark numbers stay the graphite snapshot. */
export const DARK_ROLES: AppearanceRoles = {
  text: '#F2F2F2',
  secondary: '#F2F2F2',
  tertiary: '#E8E8E8',
  ghost: '#D8D8D8',
  inverse: '#ECECEC',
  onInverse: '#181818',
  border: '#FFFFFF1F',
  borderStrong: '#FFFFFF33',
  sidebarBorder: '#FFFFFF1F',
  overlay: '#E6EAF214',
  overlayStrong: '#E6EAF224',
  menu: '#1A1A1A',
  menuHover: '#2A2A2A',
  scrim: '#00000099',
  danger: '#C45C5C',
  deskHit: '#FFFFFF03',
}

export const LIGHT_ROLES: AppearanceRoles = {
  text: LIGHT_TEXT,
  secondary: '#707070',
  tertiary: '#888888',
  ghost: '#808080',
  inverse: '#343434',
  onInverse: '#FBFBFB',
  border: '#0000001A',
  borderStrong: '#0000002B',
  sidebarBorder: '#0000001A',
  overlay: '#0000000A',
  overlayStrong: '#00000014',
  menu: LIGHT_CANVAS,
  menuHover: '#0000000A',
  scrim: '#00000066',
  danger: '#B42318',
  deskHit: '#00000008',
}

export function rolesForAppearance(appearance: Appearance): AppearanceRoles {
  return appearance === 'light' ? LIGHT_ROLES : DARK_ROLES
}
