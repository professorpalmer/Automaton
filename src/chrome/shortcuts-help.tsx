import React from 'react'
import { useChrome } from '../ui'
import { keymapByGroup } from './keymap'

/** Settings / help sheet listing live chords from KEYMAP (not stale markdown). */
export function ShortcutsHelp({ testId = 'shortcuts-help' }: { testId?: string }) {
  const chrome = useChrome()
  const T = chrome.tokens
  const groups = keymapByGroup()
  return (
    <div testId={testId} style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>Shortcuts</div>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Live chords from one keymap table — stays in sync with HID / gpuix handlers.
      </div>
      {groups.map(({ group, entries }) => (
        <div key={group} testId={`${testId}-${group.toLowerCase()}`} style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
          <div style={{ fontSize: T.type.xs, color: T.tertiary, marginTop: T.space.xs }}>{group}</div>
          {entries.map((row) => (
            <div
              key={row.id}
              testId={`${testId}-row-${row.id}`}
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: T.space.md,
                paddingTop: T.space.xxs,
                paddingBottom: T.space.xxs,
              }}
            >
              <div style={{ fontSize: T.type.sm, color: T.text, flexGrow: 1, minWidth: 0 }}>{row.action}</div>
              <div style={{ fontSize: T.type.sm, color: T.secondary, flexShrink: 0 }}>{row.chord}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
