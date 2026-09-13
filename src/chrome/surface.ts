import { DEFAULT_TOKENS, type Tokens } from '../theme/tokens'

/** Bezel group_box / card_glass_bg roles. One radius feeds border + wash. */
export type SurfaceRole = 'card' | 'group' | 'menu' | 'field' | 'composer'

export function groupBoxRadius(tokens: Tokens, role: SurfaceRole = 'card'): number {
  if (role === 'field' || role === 'group') return tokens.radius.control
  if (role === 'menu') return tokens.radius.button
  if (role === 'composer') return tokens.radius.surface
  return tokens.radius.panel
}

/**
 * Wash behind the hairline. Dark frost cards stay translucent so the window
 * frost shows through. Light raised plates are opaque grey (designed, not a
 * black dent). Menus stay opaque — alpha punch-through reads as a hole.
 */
export function groupBoxWash(tokens: Tokens, role: SurfaceRole = 'card'): string {
  if (role === 'menu') return tokens.menu
  if (role === 'composer' || role === 'field') return tokens.composer
  return tokens.raised
}

export function cardGlassBg(tokens: Tokens = DEFAULT_TOKENS): string {
  return groupBoxWash(tokens, 'card')
}

export function menuFill(tokens: Tokens = DEFAULT_TOKENS): string {
  return tokens.menu
}

export function groupBoxStyle(
  tokens: Tokens = DEFAULT_TOKENS,
  role: SurfaceRole = 'card',
): {
  borderRadius: number
  backgroundColor: string
  borderWidth: number
  borderColor: string
} {
  const radius = groupBoxRadius(tokens, role)
  return {
    borderRadius: radius,
    backgroundColor: groupBoxWash(tokens, role),
    borderWidth: tokens.stroke.hairline,
    borderColor: tokens.border,
  }
}

/** Menus (and other overlays) must not use a frosted wash. */
export function surfaceNeedsOpaqueFill(role: SurfaceRole): boolean {
  return role === 'menu'
}
