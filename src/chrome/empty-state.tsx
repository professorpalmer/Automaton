import React from 'react'
import { useTokens } from '../theme'
import { cardStyle } from '../ui'

/** Feed, Jobs, and Settings list blanks — not a generic empty-zoo. */
export function EmptyState({
  testId,
  title,
  detail,
  variant = 'plain',
  style,
}: {
  testId?: string
  title: string
  detail?: string
  variant?: 'plain' | 'card'
  style?: Record<string, unknown>
}) {
  const T = useTokens()
  const card = variant === 'card'
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
      <div style={{ fontSize: card ? T.type.sm : T.type.lg, lineHeight: card ? T.line.md : T.line.lg, color: T.secondary }}>
        {title}
      </div>
      {detail ? <div style={{ fontSize: T.type.sm, color: T.ghost }}>{detail}</div> : null}
    </div>
  )
}
