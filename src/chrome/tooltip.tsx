import React, { useState } from 'react'
import { useTokens } from '../theme'
import { groupBoxStyle, menuFill } from './surface'

/**
 * One-line tooltip microcopy (Waku recipe). No new npm lib — hover card with opaque menu fill.
 */
export function Tip({
  label,
  children,
  testId,
  side = 'bottom',
  fullWidth = false,
}: {
  label: string
  children: React.ReactNode
  testId?: string
  side?: 'top' | 'bottom' | 'right'
  fullWidth?: boolean
}) {
  const T = useTokens()
  const [open, setOpen] = useState(false)
  return (
    <div
      testId={testId}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: fullWidth ? '100%' : undefined,
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && label ? (
        <div
          testId={testId ? `${testId}-tip` : 'tip'}
          style={{
            position: 'absolute',
            ...(side === 'top'
              ? { bottom: '100%', marginBottom: T.space.xs, left: '50%', transform: 'translateX(-50%)' }
              : side === 'right'
                ? { left: '100%', marginLeft: T.space.xs, top: '50%', transform: 'translateY(-50%)' }
                : { top: '100%', marginTop: T.space.xs, left: '50%', transform: 'translateX(-50%)' }),
            ...groupBoxStyle(T, 'menu'),
            backgroundColor: menuFill(T),
            paddingLeft: T.space.sm,
            paddingRight: T.space.sm,
            paddingTop: T.space.xxs,
            paddingBottom: T.space.xxs,
            fontSize: T.type.xs,
            lineHeight: T.line.sm,
            color: T.secondary,
            whiteSpace: 'nowrap',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  )
}
