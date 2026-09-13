import React from 'react'
import { thinkingDots } from '../domain'
import { useTokens } from '../theme'
import { activityExpanded, activityVisible, pressActivityHeader, type ActivityTakeover } from './activity'
import { foldStepsByVerb, stepRow, type StepTrace } from './step-row'
import { groupBoxStyle } from './surface'

/**
 * Thinking / tool disclosure. Auto-opens while streaming; header press takes
 * over. No MotionDiv — idle parks when the zone is hidden.
 */
export function ActivityZone({
  streaming,
  held,
  onHeld,
  traces = [],
}: {
  streaming: boolean
  held: boolean | null
  onHeld: (held: boolean | null) => void
  traces?: readonly StepTrace[]
}) {
  const T = useTokens()
  const state: ActivityTakeover = { streaming, held }
  if (!activityVisible(state)) return null
  const open = activityExpanded(state)
  const folded = foldStepsByVerb(traces)
  const header =
    folded.length > 0 ? folded.map((row) => (row.count > 1 ? `${row.verb} ×${row.count}` : row.verb)).join(' · ') : 'Thinking'
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
          {streaming ? (
            <div testId="thinking" style={{ fontSize: T.type.sm, color: T.ghost }}>
              {thinkingDots(3)}
            </div>
          ) : null}
        </div>
        {open ? (
          <div testId="activity-body" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
            {folded.length === 0 ? (
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
