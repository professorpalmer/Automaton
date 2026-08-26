import { join } from 'node:path'
import { T } from './tokens'

export const PRODUCT = 'Automaton'

/** Yellow mark, no plate. Titlebar and SVG source of truth. */
export const MARK_PATH = join(import.meta.dir, '..', 'brand', 'mark.png')

export function markSvg(color = T.brand.yellow): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">`,
    `<rect x="20" y="42" width="24" height="14" rx="3" fill="${color}"/>`,
    `<path d="M16 24.5L32 42L48 24.5M32 20.5V42" stroke="${color}" stroke-width="1.75" stroke-linecap="round"/>`,
    `<circle cx="16" cy="20" r="5.5" stroke="${color}" stroke-width="2"/>`,
    `<circle cx="32" cy="16" r="5.5" stroke="${color}" stroke-width="2"/>`,
    `<circle cx="48" cy="20" r="5.5" stroke="${color}" stroke-width="2"/>`,
    `</svg>`,
  ].join('')
}
