import React, { useEffect, useState } from 'react'
import { LedgerList, PaneHeader, Section } from './inspector'
import { probeConnector } from './runtime/connector-client'
import {
  connectorStatusLabel,
  defaultOpenRouter,
  hasOpenRouterGrant,
  OPENROUTER_ID,
  readConnectors,
  type Connector,
} from './runtime/connectors'
import { listOpenRouterKeys, writeOpenRouterKey } from './runtime/keys'
import type { LedgerMetrics } from './runtime/store'
import { CHAT_THEME, T } from './tokens'

export function openRouterPresence(): 'present' | 'missing' {
  return listOpenRouterKeys().length > 0 ? 'present' : 'missing'
}

function openRouterRow(): Connector {
  return readConnectors().find((row) => row.id === OPENROUTER_ID) ?? defaultOpenRouter()
}

function shouldLiveProbe(): boolean {
  return !process.env.BUN_TEST && hasOpenRouterGrant()
}

export function Settings({
  metrics,
  onClose,
}: {
  metrics: LedgerMetrics
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [presence, setPresence] = useState(openRouterPresence)
  const [openRouter, setOpenRouter] = useState(openRouterRow)
  useEffect(() => {
    if (!shouldLiveProbe()) return
    let cancelled = false
    void probeConnector(OPENROUTER_ID).then((row) => {
      if (!cancelled) setOpenRouter(row)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const saveKey = () => {
    const key = draft.trim()
    if (!key) return
    writeOpenRouterKey(key)
    setDraft('')
    setPresence('present')
    if (!shouldLiveProbe()) return
    void probeConnector(OPENROUTER_ID).then(setOpenRouter)
  }
  return (
    <div
      testId="settings"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'scroll',
        paddingLeft: T.space.xl,
        paddingRight: T.space.xl,
        paddingTop: T.space.lg,
        paddingBottom: T.space.lg,
        gap: T.space.xl,
      }}
    >
      <PaneHeader title="Settings" onClose={onClose} closeId="settings-close" />
      <Section title="Usage">
        <LedgerList metrics={metrics} testId="settings-usage" />
      </Section>
      <Section title="Keys">
        <div
          testId="settings-keys"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: T.space.sm,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: T.space.md,
            }}
          >
            <div style={{ fontSize: T.type.sm, color: T.secondary }}>OpenRouter</div>
            <div style={{ fontSize: T.type.sm, color: T.text }}>{presence}</div>
          </div>
          <div testId="settings-secret-request" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
              Stays out of the chat. Stored securely, never shown to a mouth.
            </div>
            <textarea
              testId="settings-key-input"
              value={draft}
              placeholder="Paste the key here, not in chat"
              minRows={1}
              maxRows={2}
              theme={CHAT_THEME}
              style={{
                width: '100%',
                fontSize: T.type.sm,
                color: T.text,
                backgroundColor: T.composer,
                borderWidth: T.stroke.hairline,
                borderColor: T.border,
                borderRadius: T.radius.sm,
                paddingLeft: T.space.sm,
                paddingRight: T.space.sm,
                paddingTop: T.space.xs,
                paddingBottom: T.space.xs,
              }}
              onChange={(event) => setDraft(event.value ?? '')}
            />
            <div
              testId="settings-key-save"
              style={{
                alignSelf: 'flex-start',
                paddingLeft: T.space.md,
                paddingRight: T.space.md,
                paddingTop: T.space.xs,
                paddingBottom: T.space.xs,
                borderRadius: T.radius.sm,
                backgroundColor: T.raised,
                fontSize: T.type.sm,
                color: T.text,
                cursor: 'pointer',
                pointerEvents: 'auto',
                userSelect: 'none',
              }}
              onClick={saveKey}
            >
              Save securely
            </div>
          </div>
        </div>
      </Section>
      <Section title="Connectors">
        <div testId="settings-connectors" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
          <div
            key={openRouter.id}
            testId="connector-openrouter"
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: T.space.md,
            }}
          >
            <div style={{ fontSize: T.type.sm, color: T.text }}>{openRouter.name}</div>
            <div style={{ fontSize: T.type.sm, color: T.secondary }}>
              {connectorStatusLabel(openRouter)}
            </div>
          </div>
        </div>
      </Section>
      <Section title="Theme">
        <div testId="settings-theme" style={{ fontSize: T.type.sm, color: T.text }}>
          Graphite
        </div>
      </Section>
    </div>
  )
}
