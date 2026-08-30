import React from 'react'
import { T } from './tokens'

export const HIT = {
  cursor: 'pointer' as const,
  userSelect: 'none' as const,
}

export const FIELD_STYLE = {
  width: '100%' as const,
  fontSize: T.type.sm,
  color: T.text,
  get backgroundColor() {
    return T.composer
  },
  borderWidth: T.stroke.hairline,
  borderColor: T.border,
  borderRadius: T.radius.md,
  paddingLeft: T.space.md,
  paddingRight: T.space.md,
  paddingTop: T.space.sm,
  paddingBottom: T.space.sm,
}

/** Single-line clip. GPUIX text wrap otherwise stacks a long slug into a column. */
export const CLIP = {
  minWidth: 0,
  overflow: 'hidden' as const,
  whiteSpace: 'nowrap' as const,
  textOverflow: 'ellipsis' as const,
}

export const FIELD_LINE_STYLE = {
  ...FIELD_STYLE,
  ...CLIP,
}

export const CARD_STYLE = {
  padding: T.space.lg,
  borderRadius: T.radius.lg,
  get backgroundColor() {
    return T.raised
  },
  borderWidth: T.stroke.hairline,
  borderColor: T.border,
  display: 'flex' as const,
  flexDirection: 'column' as const,
  gap: T.space.md,
}

/** Overlays must be opaque. Alpha fills punch through Metal to the composer. */
const MENU_FILL = '#1A1A1A'
const MENU_HOVER = '#2A2A2A'

export const MENU_STYLE = {
  maxHeight: T.layout.menuMax,
  overflowY: 'scroll' as const,
  backgroundColor: MENU_FILL,
  borderWidth: T.stroke.hairline,
  borderColor: T.border,
  borderRadius: T.radius.md,
  paddingTop: T.space.xs,
  paddingBottom: T.space.xs,
}

export const ITEM_PAD = {
  paddingLeft: T.space.md,
  paddingRight: T.space.md,
  paddingTop: T.space.sm,
  paddingBottom: T.space.sm,
  fontSize: T.type.sm,
}

export function menuItemStyle(state: { highlighted?: boolean; selected?: boolean }) {
  const on = Boolean(state.highlighted || state.selected)
  return {
    ...ITEM_PAD,
    backgroundColor: on ? MENU_HOVER : MENU_FILL,
    color: on ? T.text : T.secondary,
  }
}

export type Tone = 'action' | 'primary' | 'ghost' | 'danger' | 'quiet'

export function toneFill(tone: Tone, ready = true): { backgroundColor: string; color: string } {
  if (!ready && (tone === 'action' || tone === 'primary')) {
    return { backgroundColor: T.raised, color: T.ghost }
  }
  if (tone === 'action') return { backgroundColor: T.catalog.violet, color: T.inverse }
  if (tone === 'primary') return { backgroundColor: T.inverse, color: T.onInverse }
  if (tone === 'danger') return { backgroundColor: T.danger, color: T.inverse }
  if (tone === 'quiet') return { backgroundColor: T.clear, color: T.secondary }
  return { backgroundColor: T.raised, color: T.text }
}

export function Chip({
  testId,
  tone = 'ghost',
  ready = true,
  children,
  onClick,
}: {
  testId?: string
  tone?: Tone
  ready?: boolean
  children: React.ReactNode
  onClick?: () => void
}) {
  const fill = toneFill(tone, ready)
  return (
    <div
      testId={testId}
      style={{
        alignSelf: 'flex-start',
        paddingLeft: T.space.md,
        paddingRight: T.space.md,
        paddingTop: T.space.control,
        paddingBottom: T.space.control,
        borderRadius: T.radius.md,
        fontSize: T.type.sm,
        ...fill,
        ...(ready ? HIT : { cursor: 'default' as const, userSelect: 'none' as const }),
        hover: ready ? { opacity: T.blob.hover } : undefined,
        active: ready ? { opacity: T.blob.active } : undefined,
      }}
      onClick={() => {
        if (ready) onClick?.()
      }}
    >
      {children}
    </div>
  )
}

export function Pill({
  label,
  testId,
}: {
  label: string
  testId?: string
}) {
  return (
    <div
      testId={testId}
      style={{
        paddingLeft: T.space.sm,
        paddingRight: T.space.sm,
        paddingTop: T.space.xxs,
        paddingBottom: T.space.xxs,
        borderRadius: T.radius.badge,
        backgroundColor: T.overlay,
        borderWidth: T.stroke.hairline,
        borderColor: T.border,
        fontSize: T.type.xs,
        color: T.secondary,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  )
}

/** Short family label for a mouth pin. Visual only — not a provider map. */
export function modelFamily(id: string): string {
  const raw = id.trim()
  const s = raw.toLowerCase()
  if (!s) return 'local'
  if (s.includes('grok') || s.includes('x-ai') || s.startsWith('xai/')) return 'Grok'
  if (s.includes('glm') || s.includes('zhipu') || s.includes('z-ai') || s.startsWith('zai/')) return 'GLM'
  if (s.includes('claude') || s.includes('anthropic')) return 'Claude'
  if (s.includes('gemini') || s.includes('google')) return 'Gemini'
  if (s.includes('deepseek')) return 'DeepSeek'
  if (
    s.includes('ollama') ||
    s.includes('lmstudio') ||
    s.includes('localhost') ||
    s.startsWith('local/') ||
    s.includes('llama.cpp')
  ) {
    return 'local'
  }
  if (s.includes('gpt') || s.startsWith('openai/')) return 'GPT'
  const vendor = raw.split('/')[0]?.trim()
  if (!vendor || vendor === raw) return 'local'
  return vendor.length > 10 ? vendor.slice(0, 8) : vendor
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function railClock(at: number, now = Date.now()): string {
  const then = new Date(at)
  const current = new Date(now)
  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameCalendarDay(then, current)) return time
  const yesterday = new Date(now)
  yesterday.setDate(current.getDate() - 1)
  if (sameCalendarDay(then, yesterday)) return 'Yesterday'
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function lastItemAt(items: { at?: number }[]): number | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const at = items[i]?.at
    if (typeof at === 'number' && Number.isFinite(at)) return at
  }
  return null
}
