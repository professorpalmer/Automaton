# Wave 6 — GPUI polish (toast / empty CTA / focus chords)

**Band:** P0 (feedback & findability)  
**Package:** stays on current main (no version cut in this PR)  
**Patterns only** — recipes from rgitui / ChatGPUI / Waku / Bezel. No CopilotKit, Electron, or `gpui-kit` / `gpui-component` crates.

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

No full keymap file yet — P2 shortcuts-help can generate from one table later.

## Parks (unchanged)
- Idle parks / resting-motion
- Steer queue still hint-string (P1 queue card)
- Command palette (P1)
- OS Notification Center (P2)
- No `bezel` / `gpui-kit` deps

## Audit
See `/workspace/automaton-wave6-gpui-polish-audit.md` (box) and `artifacts/automaton-wave6-gpui-polish-audit.md` when copied. P0 row status: **implemented on branch `feat/wave-6-p0-toast-empty-chords`**.
