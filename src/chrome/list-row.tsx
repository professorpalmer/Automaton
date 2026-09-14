import React, { useState } from 'react'
import { useTokens } from '../theme'

export type ListRowDensity = 'default' | 'compact'

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

/**
 * Shared list row — rgitui ListItem density + hover end-slot recipe.
 * Hover reveals secondary actions without permanent chrome growth.
 */
export function ListRow({
  testId,
  density = 'default',
  selected = false,
  startSlot,
  endSlot,
  endHoverSlot,
  children,
  onClick,
  onContextMenu,
}: {
  testId?: string
  density?: ListRowDensity
  selected?: boolean
  startSlot?: React.ReactNode
  endSlot?: React.ReactNode
  /** Shown only while the row is hovered. */
  endHoverSlot?: React.ReactNode
  children?: React.ReactNode
  onClick?: () => void
  onContextMenu?: (event: { x?: number; y?: number; isRightClick?: boolean; button?: number }) => void
}) {
  const T = useTokens()
  const [hovered, setHovered] = useState(false)
  const compact = density === 'compact'
  const padY = compact ? T.space.xs : T.space.sm
  const padX = compact ? T.space.sm : T.space.md
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: children ? 'flex-start' : 'center',
        gap: T.space.sm,
        paddingLeft: padX,
        paddingRight: padX,
        paddingTop: padY,
        paddingBottom: padY,
        borderRadius: T.radius.md,
        backgroundColor: selected ? T.selected : T.clear,
        minWidth: 0,
        width: '100%',
        ...HIT,
        hover: { backgroundColor: selected ? T.selected : T.raised },
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event) => {
        if (event.isRightClick || event.button === 2) return
        onClick?.()
      }}
      onMouseDown={(event) => {
        if (event.isRightClick || event.button === 2) onContextMenu?.(event)
      }}
    >
      {startSlot ? (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: compact ? T.blob.enterSize : undefined,
            height: compact ? T.blob.enterSize : undefined,
          }}
        >
          {startSlot}
        </div>
      ) : null}
      {children ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: T.space.xxs }}>
          {children}
        </div>
      ) : null}
      {endSlot ? <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'row', gap: T.space.xs }}>{endSlot}</div> : null}
      {endHoverSlot && hovered ? (
        <div
          testId={testId ? `${testId}-hover-end` : undefined}
          style={{ flexShrink: 0, display: 'flex', flexDirection: 'row', gap: T.space.xs }}
        >
          {endHoverSlot}
        </div>
      ) : null}
    </div>
  )
}
