# Wave 6 — GPUI polish (toast / palette / notify / pulse / shortcuts)

**Bands:** P0 (feedback) + P1 (palette / queue / density) + **P2** (background awareness & long-thread chrome)  
**Package:** stays on current main (no version cut in this PR)  
**Patterns only** — recipes from rgitui / ChatGPUI / Waku / Bezel / Zeron. No CopilotKit, Electron, or `gpui-kit` / `gpui-component` crates.

## What shipped (P0)

### Toast stack + level policy
- `src/chrome/toast-store.ts` + `src/chrome/toast.tsx`
- Levels: `info` / `success` / `warn` / `error`
- TTL: info/success **~3s**, warn **~6s**, error **sticky** (dismiss only)
- Optional action chip; severity word is text (not color-only)
- Paint **above** the composer with **opaque** `menu` fill (`menuFill` / `groupBoxStyle(..., 'menu')`) so frost Metal never punches through
- Wired paths: mouth `onFail` (error + “Show sister”), secret save fail (feed card + Settings OpenRouter / MCP Connect), update-ready info toast when git tip offers

Idle: no timers when the stack is empty; auto-dismiss timers clear on unmount/dismiss.

### EmptyState + CTA
- `EmptyState` accepts optional `icon`, `actionLabel`, `onAction`
- Feed empty → **Write something** (focuses composer via `focusNonce`)
- Jobs empty → **Expand board**
- Settings empties (routines / skills / rooms / MCP search miss) get one verb where sensible

### Focus chords
GPUIx `onKeyDown` plus the same HID watch discipline as paste/copy/quit (textarea swallows React keys):

| Chord | Action |
| --- | --- |
| **Cmd+L** | Focus composer |
| **Cmd+B** | Toggle rail compact ↔ default width |
| **Cmd+,** | Toggle Settings sheet |
| **Cmd+J** | Toggle Jobs sheet |
| Cmd+Shift+I | Inspector (existing) |

## What shipped (P1)

### Command palette lite (Cmd+K)
- `src/chrome/command-palette.tsx` + `src/chrome/palette.ts`
- Overlay: fuzzy **Sisters** / **Rooms** / **Settings** sections / **Jobs**
- Search field keeps focus; list cursor is drawn separately
- **Esc** clears the query first, then closes
- Events only (select sister / room / open settings section / open Jobs) — no command ontology kit
- Opaque `menuFill` card

### Visible steer queue card
- `src/chrome/steer-queue.tsx` above the composer
- One opaque card; one row per queued line
- **Remove** / **Send now** (promote when busy; send that line alone when idle)
- Quiet microcopy when Send would queue and the queue is empty
- Session: `removeSteerAt` / `sendSteerNow`

### List density + hover end-slot
- Shared `ListRow` (`src/chrome/list-row.tsx`) — compact/default density
- Settings routines / skills / rooms: secondary actions reveal on hover
- Rail New / Settings footer rows use `ListRow` (compact when rail is compact)

### Tooltip microcopy
- `Tip` (`src/chrome/tooltip.tsx`) — one-line raised opaque card; no new npm lib
- Titlebar Computer / Jobs; rail New / Settings / sister hits

| Chord | Action |
| --- | --- |
| **Cmd+K** | Toggle command palette |

## What shipped (P2)

### OS notification (Mac)
- `src/runtime/os-notify.ts` — optional **Settings → Window → Background notify** (`skin.osNotifyBackground`)
- Banner when a mouth completes or host approval parks **while unfocused**
- **Quiet** = setting Off (default); kill-switch `AUTOMATON_DISABLE_NOTIFICATIONS`
- Failures swallowed; `display notification` via osascript (no new deps)
- Parks sister id; when Automaton becomes frontmost, selects that sister (click routing for plain banners is limited)

### Pulse lease strides
- `src/motion/pulse.ts` — default **1.2s** / slow **2.4s** (Waku `pulse_lease` / `pulse_lease_slow` recipe)
- `MouthWaitBubble` + Activity streaming dots take slow stride when feed ≥40 or Activity open
- Unmount parks — no JS clock; see `docs/idle-cpu.md`

### Overlay edge fade (spike)
- `src/chrome/edge-fade.tsx` — feed wrapped in `EdgeFadeFrame`
- Simple two-stop linear-gradient opacity ramp (gpuix); no EdgeFade crate
- Does **not** change opaque menu/toast fills (frost punch-through still owned there)

### Shortcuts help
- `src/chrome/keymap.ts` **`KEYMAP`** — one live table
- `ShortcutsHelp` in Settings (+ palette section **Shortcuts**)
- Generated from `KEYMAP`, not a stale markdown list

### Parked
- Message tick rail (P2.5) — skipped (not trivial / no measured pain)

## Parks (unchanged spirit)
- Idle parks / resting-motion + pulse-stride / os-notify-focus inventory entries
- Opaque overlays for toasts / palette / queue / tips
- No `bezel` / `gpui-kit` deps

## Audit
See `/workspace/automaton-wave6-gpui-polish-audit.md` (box) and `artifacts/automaton-wave6-gpui-polish-audit.md` when copied.  
P0: v0.13.0. P1: v0.14.0. P2: branch `feat/wave-6-p2-notify-pulse-shortcuts` (no version cut).
