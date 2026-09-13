import { chromeFromSkin, type Skin } from '../runtime/skin'
import { parseAppearance, rolesForAppearance } from './appearance'
import { radiiFromBrand } from './brand'
import { DEFAULT_TOKENS, type Tokens } from './tokens'

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  Object.freeze(value)
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child)
  }
  return value
}

/** Replace the token object (immutable snapshot). Never assign through `T`. */
export function tokensFromSkin(skin: Skin): Tokens {
  const chrome = chromeFromSkin(skin)
  const appearance = parseAppearance(skin.appearance)
  const roles = rolesForAppearance(appearance)
  return freezeDeep({
    ...DEFAULT_TOKENS,
    appearance,
    windowMode: skin.windowMode,
    text: roles.text,
    inverse: roles.inverse,
    onInverse: roles.onInverse,
    border: roles.border,
    borderStrong: roles.borderStrong,
    sidebarBorder: roles.sidebarBorder,
    overlay: roles.overlay,
    overlayStrong: roles.overlayStrong,
    menu: roles.menu,
    menuHover: roles.menuHover,
    scrim: roles.scrim,
    danger: roles.danger,
    desk: { ...DEFAULT_TOKENS.desk, hit: roles.deskHit },
    canvas: chrome.canvas,
    sidebar: chrome.sidebar,
    composer: chrome.composer,
    raised: chrome.raised,
    selected: chrome.selected,
    secondary: chrome.secondary,
    tertiary: chrome.tertiary,
    ghost: chrome.ghost,
    accent: chrome.accent,
    radius: radiiFromBrand(skin.brand),
  })
}
