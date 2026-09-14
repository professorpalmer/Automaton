# Wave 6 — GPUI polish (toast / palette / steer / density)

**Bands:** P0 (feedback & findability) + **P1** (palette, queue chrome, density)  
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

No full keymap file yet — P2 shortcuts-help can generate from one table later.

## Parks (unchanged)
- Idle parks / resting-motion
- OS Notification Center (P2)
- Pulse lease strides / overlay scrollbar (P2)
- No `bezel` / `gpui-kit` deps

## Audit
See `/workspace/automaton-wave6-gpui-polish-audit.md` (box) and `artifacts/automaton-wave6-gpui-polish-audit.md` when copied.  
P0: shipped v0.13.0. P1: branch `feat/wave-6-p1-palette-steer-density`.
