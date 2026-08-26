import { join } from 'node:path'
import { T } from './tokens'

export const PRODUCT = 'Automaton'

/** White control-bar mark, no plate. Titlebar and SVG source of truth. */
export const MARK_PATH = join(import.meta.dir, '..', 'brand', 'mark.png')

export function markSvg(color = T.inverse): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">`,
    `<rect x="10" y="14" width="44" height="8" rx="4" fill="${color}"/>`,
    `<path d="M18 22V46M32 22V50M46 22V46" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    `<circle cx="18" cy="48" r="3.2" fill="${color}"/>`,
    `<circle cx="32" cy="52" r="3.2" fill="${color}"/>`,
    `<circle cx="46" cy="48" r="3.2" fill="${color}"/>`,
    `</svg>`,
  ].join('')
}
