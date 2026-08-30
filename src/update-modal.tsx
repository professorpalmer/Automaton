import React from 'react'
import { T } from './tokens'
import { Chip } from './ui'

export function UpdateModal({
  dirty = false,
  busy = false,
  note = '',
  onUpdate,
  onLater,
}: {
  dirty?: boolean
  busy?: boolean
  note?: string
  onUpdate: () => void
  onLater: () => void
}) {
  return (
    <div
      testId="update-modal"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#00000099',
        pointerEvents: 'auto',
      }}
    >
      <div
        testId="update-card"
        style={{
          width: 320,
          minWidth: 0,
          padding: T.space.xl,
          borderRadius: T.radius.lg,
          backgroundColor: '#1A1A1A',
          borderWidth: T.stroke.hairline,
          borderColor: T.border,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space.md,
        }}
      >
        <div style={{ fontSize: T.type.lg, lineHeight: T.line.lg, color: T.text }}>Updates available</div>
        <div style={{ fontSize: T.type.sm, lineHeight: T.line.sm, color: T.secondary, whiteSpace: 'normal' }}>
          A newer Automaton is on main. Update to pick it up.
        </div>
        {dirty ? (
          <div testId="update-dirty" style={{ fontSize: T.type.sm, color: T.tertiary, whiteSpace: 'normal' }}>
            Local changes are in the way. Commit or stash first.
          </div>
        ) : null}
        {note ? (
          <div testId="update-note" style={{ fontSize: T.type.sm, color: T.tertiary, whiteSpace: 'normal' }}>
            {note}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
          <Chip testId="update-apply" tone="action" ready={!dirty && !busy} onClick={onUpdate}>
            {busy ? 'Updating' : 'Update'}
          </Chip>
          <Chip testId="update-later" tone="ghost" ready={!busy} onClick={onLater}>
            Later
          </Chip>
        </div>
      </div>
    </div>
  )
}
