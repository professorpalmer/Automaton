import React from 'react'
import type { SteerLine } from '../domain'
import { useTokens } from '../theme'
import { Chip } from '../ui'
import { groupBoxStyle, menuFill } from './surface'

/** Visible steer queue card above the composer — one row per queued line. Opaque fill. */
export function SteerQueueCard({
  lines,
  queueing = false,
  onRemove,
  onSendNow,
}: {
  lines: readonly SteerLine[]
  /** Mouth will park Send until the turn ends. Quiet microcopy when empty queue. */
  queueing?: boolean
  onRemove: (index: number) => void
  onSendNow: (index: number) => void
}) {
  const T = useTokens()
  if (lines.length === 0 && !queueing) return null
  if (lines.length === 0 && queueing) {
    return (
      <div
        testId="steer-queue-hint"
        style={{
          paddingLeft: T.feed.gutter,
          paddingRight: T.feed.gutter,
          paddingBottom: T.space.xs,
          width: '100%',
          maxWidth: T.layout.contentMax,
          alignSelf: 'center',
        }}
      >
        <div style={{ fontSize: T.type.xs, color: T.ghost }}>Send queues until this turn ends</div>
      </div>
    )
  }
  return (
    <div
      testId="steer-queue"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingLeft: T.feed.gutter,
        paddingRight: T.feed.gutter,
        paddingBottom: T.space.xs,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          ...groupBoxStyle(T, 'menu'),
          backgroundColor: menuFill(T),
          width: '100%',
          maxWidth: T.layout.contentMax,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space.xxs,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          paddingLeft: T.space.md,
          paddingRight: T.space.md,
        }}
      >
        <div
          testId="steer-queue-label"
          style={{ fontSize: T.type.xs, color: T.ghost, paddingBottom: T.space.xxs }}
        >
          {lines.length === 1 ? '1 queued' : `${lines.length} queued`}
        </div>
        {lines.map((line, index) => (
          <div
            key={`steer-${index}-${line.text.slice(0, 24)}`}
            testId={`steer-queue-row-${index}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: T.space.sm,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: T.type.sm,
                color: T.text,
                flexGrow: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {line.text.trim() || '(attachment)'}
            </div>
            <Chip testId={`steer-queue-send-${index}`} tone="ghost" onClick={() => onSendNow(index)}>
              Send now
            </Chip>
            <Chip testId={`steer-queue-remove-${index}`} tone="ghost" onClick={() => onRemove(index)}>
              Remove
            </Chip>
          </div>
        ))}
      </div>
    </div>
  )
}
