import React from 'react'
import { groupBoxStyle } from './chrome/surface'
import { useTokens } from './theme'
import { Chip } from './ui'

export function UpdateModal({
  dirty = false,
  busy = false,
  note = '',
  kind = 'git',
  installed = '',
  latestTag = '',
  onUpdate,
  onLater,
}: {
  dirty?: boolean
  busy?: boolean
  note?: string
  /** git = tip behind origin/main; release = installed semver behind GitHub Latest. */
  kind?: 'git' | 'release'
  installed?: string
  latestTag?: string
  onUpdate: () => void
  onLater: () => void
}) {
  const T = useTokens()
  const title = kind === 'release' ? 'Release available' : 'Updates available'
  const body =
    kind === 'release'
      ? `Installed ${installed || '—'} · latest ${latestTag || '—'}. Update to pick it up (fast-forward main, then relaunch).`
      : 'A newer Automaton is on main. Update to pick it up.'
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
        backgroundColor: T.scrim,
        pointerEvents: 'auto',
      }}
    >
      <div
        testId="update-card"
        style={{
          width: 320,
          minWidth: 0,
          padding: T.space.xl,
          ...groupBoxStyle(T, 'menu'),
          display: 'flex',
          flexDirection: 'column',
          gap: T.space.md,
        }}
      >
        <div style={{ fontSize: T.type.lg, lineHeight: T.line.lg, color: T.text }}>{title}</div>
        <div
          testId={kind === 'release' ? 'update-release-detail' : 'update-git-detail'}
          style={{ fontSize: T.type.sm, lineHeight: T.line.sm, color: T.secondary, whiteSpace: 'normal' }}
        >
          {body}
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
