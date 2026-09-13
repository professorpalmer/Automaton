import { chromeFromSkin, type Skin } from '../runtime/skin'
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
  return freezeDeep({
    ...DEFAULT_TOKENS,
    canvas: chrome.canvas,
    sidebar: chrome.sidebar,
    composer: chrome.composer,
    raised: chrome.raised,
    selected: chrome.selected,
    secondary: chrome.secondary,
    tertiary: chrome.tertiary,
    ghost: chrome.ghost,
    accent: skin.brand.accent,
    radius: radiiFromBrand(skin.brand),
  })
}
