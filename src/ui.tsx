import React from 'react'
import { groupBoxStyle } from './chrome/surface'
import { toFieldTheme } from './theme/adapters'
import { useTokens } from './theme'
import { DEFAULT_TOKENS, type Tokens } from './theme/tokens'

export const HIT = {
  cursor: 'pointer' as const,
  userSelect: 'none' as const,
}

export function fieldStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    width: '100%' as const,
    fontSize: tokens.type.sm,
    color: tokens.text,
    ...groupBoxStyle(tokens, 'field'),
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.md,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.sm,
  }
}

/** Default-snapshot field chrome. Prefer `fieldStyle(useTokens())` on live paint. */
export const FIELD_STYLE = fieldStyle()

/** Single-line clip. GPUIX text wrap otherwise stacks a long slug into a column. */
export const CLIP = {
  minWidth: 0,
  overflow: 'hidden' as const,
  whiteSpace: 'nowrap' as const,
  textOverflow: 'ellipsis' as const,
}

export function fieldLineStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    ...fieldStyle(tokens),
    ...CLIP,
  }
}

export const FIELD_LINE_STYLE = fieldLineStyle()

export function cardStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    ...groupBoxStyle(tokens, 'card'),
    padding: tokens.space.lg,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: tokens.space.md,
  }
}

export const CARD_STYLE = cardStyle()

export function menuStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    ...groupBoxStyle(tokens, 'menu'),
    maxHeight: tokens.layout.menuMax,
    overflowY: 'scroll' as const,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
  }
}

/** Live Brand-aware chrome. Settings / inspector should not pin CARD_STYLE. */
export function useChrome() {
  const tokens = useTokens()
  return {
    tokens,
    card: cardStyle(tokens),
    menu: menuStyle(tokens),
    field: fieldStyle(tokens),
    fieldLine: fieldLineStyle(tokens),
    fieldTheme: toFieldTheme(tokens),
    itemPad: itemPad(tokens),
  }
}

export const MENU_STYLE = menuStyle()

export function itemPad(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.md,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.sm,
    fontSize: tokens.type.sm,
  }
}

export const ITEM_PAD = itemPad()

export function menuItemStyle(
  state: { highlighted?: boolean; selected?: boolean },
  tokens: Tokens = DEFAULT_TOKENS,
) {
  const on = Boolean(state.highlighted || state.selected)
  return {
    ...itemPad(tokens),
    backgroundColor: on ? tokens.menuHover : tokens.menu,
    color: on ? tokens.text : tokens.secondary,
  }
}

export type Tone = 'action' | 'primary' | 'ghost' | 'danger' | 'quiet'

export function toneFill(
  tone: Tone,
  ready = true,
  tokens: Tokens = DEFAULT_TOKENS,
): { backgroundColor: string; color: string } {
  if (!ready && (tone === 'action' || tone === 'primary')) {
    return { backgroundColor: tokens.raised, color: tokens.ghost }
  }
  if (tone === 'action') return { backgroundColor: tokens.catalog.violet, color: tokens.inverse }
  if (tone === 'primary') return { backgroundColor: tokens.inverse, color: tokens.onInverse }
  if (tone === 'danger') return { backgroundColor: tokens.danger, color: tokens.inverse }
  if (tone === 'quiet') return { backgroundColor: tokens.clear, color: tokens.secondary }
  return { backgroundColor: tokens.raised, color: tokens.text }
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
  const tokens = useTokens()
  const fill = toneFill(tone, ready, tokens)
  return (
    <div
      testId={testId}
      style={{
        alignSelf: 'flex-start',
        paddingLeft: tokens.space.md,
        paddingRight: tokens.space.md,
        paddingTop: tokens.space.control,
        paddingBottom: tokens.space.control,
        borderRadius: tokens.radius.md,
        fontSize: tokens.type.sm,
        ...fill,
        ...(ready ? HIT : { cursor: 'default' as const, userSelect: 'none' as const }),
        hover: ready ? { opacity: tokens.blob.hover } : undefined,
        active: ready ? { opacity: tokens.blob.active } : undefined,
      }}
      onMouseDown={(event: { button?: number; isRightClick?: boolean }) => {
        if (event.isRightClick || event.button === 2) return
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
  const tokens = useTokens()
  return (
    <div
      testId={testId}
      style={{
        paddingLeft: tokens.space.sm,
        paddingRight: tokens.space.sm,
        paddingTop: tokens.space.xxs,
        paddingBottom: tokens.space.xxs,
        borderRadius: tokens.radius.badge,
        backgroundColor: tokens.overlay,
        borderWidth: tokens.stroke.hairline,
        borderColor: tokens.border,
        fontSize: tokens.type.xs,
        color: tokens.secondary,
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
