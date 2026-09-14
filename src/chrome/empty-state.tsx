import React from 'react'
import { useTokens } from '../theme'
import { cardStyle, Chip } from '../ui'

/** Feed, Jobs, and Settings list blanks — not a generic empty-zoo. */
export function EmptyState({
  testId,
  title,
  detail,
  icon,
  actionLabel,
  onAction,
  variant = 'plain',
  style,
}: {
  testId?: string
  title: string
  detail?: string
  /** Optional leading glyph or mark (string or node). */
  icon?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  variant?: 'plain' | 'card'
  style?: Record<string, unknown>
}) {
  const T = useTokens()
  const card = variant === 'card'
  const showAction = Boolean(actionLabel && onAction)
  return (
    <div
      testId={testId}
      style={{
        ...(card ? cardStyle(T) : {}),
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.sm,
        fontSize: card ? T.type.sm : T.type.lg,
        lineHeight: card ? T.line.md : T.line.lg,
        color: T.secondary,
        ...style,
      }}
    >
      {icon ? (
        <div testId={testId ? `${testId}-icon` : undefined} style={{ fontSize: T.type.xl, color: T.tertiary }}>
          {icon}
        </div>
      ) : null}
      <div style={{ fontSize: card ? T.type.sm : T.type.lg, lineHeight: card ? T.line.md : T.line.lg, color: T.secondary }}>
        {title}
      </div>
      {detail ? <div style={{ fontSize: T.type.sm, color: T.ghost }}>{detail}</div> : null}
      {showAction ? (
        <Chip testId={testId ? `${testId}-action` : 'empty-state-action'} tone="action" onClick={onAction}>
          {actionLabel}
        </Chip>
      ) : null}
    </div>
  )
}
