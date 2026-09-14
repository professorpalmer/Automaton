import React, { useState } from 'react'
import { motion } from '@gpuix/react'
import { PULSE_CURVE, pulseDuration } from '../motion/pulse'
import { useTokens } from '../theme'

/**
 * One line for one mouth / hop / escalation step (OpenBot ToolLine pattern).
 * Native GPUI only — no CopilotKit useRenderTool, no generative UI.
 * Running shimmer reuses pulse lease (no new motion libs).
 */
export function ToolLine({
  testId,
  label,
  detail,
  running,
  refused,
  failed,
  children,
}: {
  testId?: string
  /** A couple of words: "Shell", "Sent to Kernel", "Asked you". */
  label: string
  /** Truncated target — path / peer / question snippet. Never secrets. */
  detail?: string
  running?: boolean
  /** Policy / boundary said no. */
  refused?: boolean
  /** Permitted but did not work. */
  failed?: boolean
  /** Disclosure body. Without it the line is not expandable. */
  children?: React.ReactNode
}) {
  const T = useTokens()
  const [open, setOpen] = useState(false)
  const tone = refused ? T.danger : failed ? T.secondary : T.tertiary
  const shown = refused ? 'Blocked' : failed ? `${label}, didn't work` : label
  const detailText = detail?.trim()
  const expandable = children != null
  const row = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: T.space.xs,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {expandable ? (
        <div
          aria-hidden
          style={{
            fontSize: T.type.xs,
            color: T.tertiary,
            transform: open ? 'rotate(90deg)' : undefined,
            flexShrink: 0,
          }}
        >
          ▸
        </div>
      ) : null}
      {running ? (
        <motion.div
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: pulseDuration('default'), repeat: Infinity, ease: PULSE_CURVE }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: T.space.xs,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <div style={{ fontSize: T.type.xs, color: tone, flexShrink: 0 }}>{shown}</div>
          {detailText ? (
            <div
              style={{
                fontSize: T.type.xs,
                color: tone,
                opacity: 0.7,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {detailText}
            </div>
          ) : null}
        </motion.div>
      ) : (
        <>
          <div style={{ fontSize: T.type.xs, color: tone, flexShrink: 0 }}>{shown}</div>
          {detailText ? (
            <div
              style={{
                fontSize: T.type.xs,
                color: tone,
                opacity: 0.7,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {detailText}
            </div>
          ) : null}
        </>
      )}
    </div>
  )

  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        alignSelf: 'flex-start',
        gap: T.space.xxs,
        paddingTop: T.space.xxs,
        paddingBottom: T.space.xxs,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {expandable ? (
        <div
          testId={testId ? `${testId}-summary` : undefined}
          style={{ cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none' }}
          onClick={() => setOpen((value) => !value)}
        >
          {row}
        </div>
      ) : (
        row
      )}
      {expandable && open ? (
        <div
          testId={testId ? `${testId}-detail` : undefined}
          style={{
            marginLeft: T.space.sm,
            paddingLeft: T.space.sm,
            borderLeftWidth: T.stroke.hairline,
            borderLeftColor: T.border,
            fontSize: T.type.xs,
            color: T.secondary,
            display: 'flex',
            flexDirection: 'column',
            gap: T.space.xxs,
            maxHeight: 320,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Sticky composer banner until next Send — stalled / failed turn honesty. */
export function StoppedTurnBanner({
  reason,
  testId = 'stopped-turn-banner',
}: {
  reason: string
  testId?: string
}) {
  const T = useTokens()
  const text = reason.trim() || 'The mouth stopped without saying why.'
  return (
    <div
      testId={testId}
      style={{
        marginLeft: T.space.xl,
        marginRight: T.space.xl,
        marginBottom: T.space.sm,
        padding: T.space.sm,
        borderRadius: T.radius.sm,
        backgroundColor: T.raised,
        borderWidth: T.stroke.hairline,
        borderColor: T.border,
      }}
    >
      <div style={{ fontSize: T.type.xs, color: T.danger }}>{text}</div>
    </div>
  )
}
