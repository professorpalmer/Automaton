import React, { useEffect, useState } from 'react'
import { useTokens } from '../theme'
import { Chip } from '../ui'
import { groupBoxStyle, menuFill } from './surface'
import {
  dismissToast,
  listToasts,
  subscribeToasts,
  toastLevelLabel,
  toastTtlMs,
  type ToastEntry,
  type ToastLevel,
} from './toast-store'

function levelAccent(level: ToastLevel, danger: string, green: string, orange: string, accent: string): string {
  if (level === 'error') return danger
  if (level === 'success') return green
  if (level === 'warn') return orange
  return accent
}

function ToastCard({
  entry,
  onDismiss,
}: {
  entry: ToastEntry
  onDismiss: (id: string) => void
}) {
  const T = useTokens()
  const ttl = toastTtlMs(entry.level)
  useEffect(() => {
    if (ttl == null) return
    const timer = setTimeout(() => onDismiss(entry.id), ttl)
    return () => clearTimeout(timer)
  }, [entry.id, ttl, onDismiss])

  const accent = levelAccent(entry.level, T.danger, T.catalog.green, T.catalog.orange, T.accent)
  return (
    <div
      testId={`toast-${entry.id}`}
      style={{
        ...groupBoxStyle(T, 'menu'),
        backgroundColor: menuFill(T),
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: T.space.sm,
        padding: T.space.md,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs, flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontSize: T.type.xs, color: accent, fontWeight: 600 }}>{toastLevelLabel(entry.level)}</div>
        <div style={{ fontSize: T.type.sm, color: T.text, lineHeight: T.line.md }}>{entry.message}</div>
        {entry.action ? (
          <Chip
            testId={`toast-${entry.id}-action`}
            tone="action"
            onClick={() => {
              entry.action?.onAction()
              onDismiss(entry.id)
            }}
          >
            {entry.action.label}
          </Chip>
        ) : null}
      </div>
      <div
        testId={`toast-${entry.id}-dismiss`}
        style={{
          fontSize: T.type.sm,
          color: T.tertiary,
          paddingLeft: T.space.sm,
          paddingRight: T.space.sm,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => onDismiss(entry.id)}
      >
        ×
      </div>
    </div>
  )
}

/** Opaque stack above the composer — menu fill so Metal never punches through. */
export function ToastStack({
  style,
}: {
  style?: Record<string, unknown>
}) {
  const T = useTokens()
  const [rows, setRows] = useState<ToastEntry[]>(() => listToasts())
  useEffect(() => subscribeToasts(() => setRows(listToasts())), [])
  if (rows.length === 0) return null
  return (
    <div
      testId="toast-stack"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.sm,
        width: '100%',
        pointerEvents: 'auto',
        ...style,
      }}
    >
      {rows.map((entry) => (
        <ToastCard key={entry.id} entry={entry} onDismiss={dismissToast} />
      ))}
    </div>
  )
}
