import React from 'react'
import { thinkingDots } from '../domain'
import type { SessionActivityRow } from '../runtime/session-activity'
import { activityHeaderSummary } from '../runtime/session-activity'
import { useTokens } from '../theme'
import { activityExpanded, activityVisible, pressActivityHeader, type ActivityTakeover } from './activity'
import { foldStepsByVerb, stepRow, type StepTrace } from './step-row'
import { groupBoxStyle } from './surface'

/**
 * Tool disclosure + Wave 4 P2 session Activity strip.
 * Mouth wait is MouthWaitBubble (bubble slot), not this bar.
 * Auto-opens while streaming with steps; header press takes over. Session commands/files
 * (paths/sizes only for writes) stay as a collapsed strip after the turn —
 * derived from mouth-stream / ledger, not a second audit DB. No MotionDiv.
 */
export function ActivityZone({
  streaming,
  held,
  onHeld,
  traces = [],
  sessionActivity = [],
}: {
  streaming: boolean
  held: boolean | null
  onHeld: (held: boolean | null) => void
  traces?: readonly StepTrace[]
  /** Ephemeral commands/files this sister session (Wave 4 P2). */
  sessionActivity?: readonly SessionActivityRow[]
}) {
  const T = useTokens()
  const state: ActivityTakeover = {
    streaming,
    held,
    hasSessionActivity: sessionActivity.length > 0,
  }
  if (!activityVisible(state)) return null
  const open = activityExpanded(state)
  const folded = foldStepsByVerb(traces)
  const activitySummary = activityHeaderSummary(sessionActivity)
  const jobHeader =
    folded.length > 0 ? folded.map((row) => (row.count > 1 ? `${row.verb} ×${row.count}` : row.verb)).join(' · ') : ''
  const header = activitySummary || jobHeader || 'Activity'
  return (
    <div
      testId="activity"
      style={{
        width: '100%',
        paddingLeft: T.feed.gutter,
        paddingRight: T.feed.gutter,
        paddingTop: T.feed.turn,
      }}
    >
      <div style={{ ...groupBoxStyle(T, 'group'), padding: T.space.sm, display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
        <div
          testId="activity-header"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: T.space.sm,
            cursor: 'pointer',
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
          onClick={() => onHeld(pressActivityHeader(state).held)}
        >
          <div style={{ fontSize: T.type.sm, color: T.secondary, flexGrow: 1 }}>{header}</div>
        </div>
        {open ? (
          <div testId="activity-body" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
            {sessionActivity.length > 0 ? (
              <div testId="session-activity" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
                {sessionActivity.map((row) => (
                  <div
                    key={row.id}
                    testId={`session-activity-${row.kind}-${row.id}`}
                    style={{
                      fontSize: T.type.sm,
                      color: row.decision === 'refuse' ? T.danger : T.tertiary,
                    }}
                  >
                    {row.label}
                  </div>
                ))}
              </div>
            ) : null}
            {folded.length === 0 && sessionActivity.length === 0 ? (
              <div style={{ fontSize: T.type.sm, color: T.ghost }}>{streaming ? thinkingDots(3) : 'Parked'}</div>
            ) : (
              folded.flatMap((group) =>
                group.items.map((row, index) => (
                  <div
                    key={`${group.verb}-${index}-${row.detail}`}
                    testId={`step-row-${group.verb}-${index}`}
                    style={{ fontSize: T.type.sm, color: T.tertiary }}
                  >
                    {stepRow(row.verb, row.detail)}
                  </div>
                )),
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
