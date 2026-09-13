# Token provenance (P0)

Measured Automaton chrome numbers. Style is a TypeScript lift of Bezel
mechanics (environment-read tokens, Brand knobs, named MotionSpec) — not a
bezel crate. Dark-first; no designed light mode in this pass.

Package / Info.plist are **0.5.0** (Wave 2 P0 band cut).

Sources: this checkout’s `src/theme/tokens.ts` (formerly `src/tokens.ts`),
`src/main.tsx` window options, and Bezel’s own measured notes where the
*pattern* (not the crate) was copied. Dates are when Automaton recorded
the number or last re-verified it.

## Window / titlebar

| Token | Value | Source | Date |
| --- | --- | --- | --- |
| `window.width` / `window.height` | 1280 × 860 | Default GPUI window in `src/main.tsx`; staff face size since the native shell | 2026-08 (staff surface) / re-stated 2026-09-13 |
| `window.trafficLightX` / `Y` | 16 / 17 | macOS traffic-light inset passed to gpuix `render(…)` so the titlebar mark clears the system buttons | 2026-08 / re-stated 2026-09-13 |
| `layout.titlebarHeight` | 52 | Native titlebar row (mark + name + Jobs). Fits 17px lights + padding without crowding | 2026-08 / re-stated 2026-09-13 |
| `layout.trafficLightClearance` | 86 | Left pad on Darwin so titlebar content starts after the lights (`TRAFFIC` in `src/app.tsx`) | 2026-08 / re-stated 2026-09-13 |

Bezel’s SwiftUI frost notes (material opacity / sigma) are **not** lifted —
Automaton keeps AppKit `windowBackground: 'blurred' \| 'opaque'` plus a
wash alpha on `canvas`. See `chromeFromSkin` in `src/runtime/skin.ts`.

## Rail / sidebar

| Token | Value | Source | Date |
| --- | --- | --- | --- |
| `layout.sidebarMin` | 72 | Icon-only compact rail (blob slot 46 + pad) | 2026-08 / re-stated 2026-09-13 |
| `layout.sidebarCompact` | 140 | Compact threshold (`railIsCompact`) | 2026-08 / re-stated 2026-09-13 |
| `layout.sidebarWidth` | 268 | Default rail; persisted as `railWidth` in `~/.automaton/skin.json` | 2026-08 / re-stated 2026-09-13 |
| `layout.sidebarMax` | 380 | Drag clamp | 2026-08 / re-stated 2026-09-13 |
| `layout.railHandle` | 8 | Resize hit strip between rail and stage | 2026-08 / re-stated 2026-09-13 |

## Feed / composer gutters

| Token | Value | Source | Date |
| --- | --- | --- | --- |
| `feed.gutter` | 28 | Stage left/right inset; composer + bubbles share it | 2026-08 / re-stated 2026-09-13 |
| `feed.turn` | 28 | Vertical gap between turns | 2026-08 / re-stated 2026-09-13 |
| `feed.padX` / `padY` | 18 / 14 | Bubble padding | 2026-08 / re-stated 2026-09-13 |
| `feed.max` | 680 | Bubble max width | 2026-08 / re-stated 2026-09-13 |
| `layout.contentMax` | 760 | Composer column max | 2026-08 / re-stated 2026-09-13 |

## Brand radius ladder

Default base (`Brand.radius`) is **6** (control). Derived set, Bezel-style:

| Name | Formula | Default |
| --- | --- | --- |
| `control` / `sm` | base | 6 |
| `bubble` / `badge` | base + 2 | 8 |
| `button` / `md` | base + 4 | 10 |
| `panel` / `lg` | base + 8 | 14 |
| `surface` / `xl` | base + 12 | 18 |
| `pill` | 999 | 999 |

Tint default `#101010` is the frost canvas RGB (wash alpha from
`frostWash`). Accent default `#D4D4D4` is the graphite emphasis token.
Persisted under `brand` in `~/.automaton/skin.json`.

## MotionSpec (named; seconds for gpuix)

| Name | Duration | Curve | Source |
| --- | --- | --- | --- |
| `railResize` / `paneIn` | 0.2 | easeOut | `T.motion.pane` |
| `unreadFade` | 0.2 | easeOut | `T.motion.unread` |
| `blobEnter` | 0.28 | easeOut | `T.motion.enter` |
| `blobSelected` | 0.16 | easeOut | `T.motion.selected` |
| `blobBreathe` | 2 | easeInOut | `T.motion.breathe` |
| `strip` | 0.2 | easeOut | `T.motion.strip` |
| `attachBar` | 0.16 | easeOut | `T.attach.barMs` |

Springs stay named (`gelatin`, `eye`) in `src/motion/specs.ts` and still
unsubscribe at rest (`src/resting-motion.ts`, settle ≤420ms).

## Honesty

Numbers above are Automaton’s own chrome, not a claim that they were
remeasured off SwiftUI on 2026-09-13. Where Bezel published a measured
date (frost materials, 2026-08-30/31), that is Bezel’s notebook — we did
not copy those opacities into this product.
