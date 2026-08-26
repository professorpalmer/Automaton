import React, { useEffect, useState } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@gpuix/react'
import { LedgerList, PaneHeader, Section } from './inspector'
import { listOpenRouterModels, probeConnector, type CatalogModel } from './runtime/connector-client'
import {
  connectorStatusLabel,
  defaultOpenRouter,
  hasOpenRouterGrant,
  OPENROUTER_ID,
  readConnectors,
  type Connector,
} from './runtime/connectors'
import { listOpenRouterKeys, writeOpenRouterKey } from './runtime/keys'
import { boxStatus, computerLabel } from './runtime/box'
import { seatModel, writePlane } from './runtime/plane'
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

function withPin(rows: CatalogModel[], pin: string): CatalogModel[] {
  if (!pin) return rows
  if (rows.some((row) => row.id === pin)) return rows
  return [{ id: pin, name: pin }, ...rows]
}

const FIELD_STYLE = {
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
}

const ITEM_PAD = {
  paddingLeft: T.space.sm,
  paddingRight: T.space.sm,
  paddingTop: T.space.xs,
  paddingBottom: T.space.xs,
  fontSize: T.type.sm,
}

export function Settings({
  metrics,
  onClose,
}: {
  metrics: LedgerMetrics
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [modelDraft, setModelDraft] = useState(() => seatModel())
  const [presence, setPresence] = useState(openRouterPresence)
  const [openRouter, setOpenRouter] = useState(openRouterRow)
  const [catalog, setCatalog] = useState<CatalogModel[]>(() => {
    const pin = seatModel()
    return [{ id: pin, name: pin }]
  })
  const loadCatalog = () => {
    if (!shouldLiveProbe()) return
    void listOpenRouterModels().then((rows) => {
      setCatalog(withPin(rows, seatModel()))
    })
  }
  useEffect(() => {
    if (!shouldLiveProbe()) return
    let cancelled = false
    void probeConnector(OPENROUTER_ID).then((row) => {
      if (!cancelled) setOpenRouter(row)
    })
    void listOpenRouterModels().then((rows) => {
      if (!cancelled) setCatalog(withPin(rows, seatModel()))
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
    loadCatalog()
  }
  const pickModel = (value: string) => {
    const model = value.trim()
    if (!model) return
    writePlane({ model })
    setModelDraft(model)
    setCatalog((current) => withPin(current, model))
  }
  const ids = catalog.map((row) => row.id)
  return (
    <div
      testId="settings"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        height: '100%',
        minHeight: 0,
        overflowY: 'scroll',
        paddingLeft: T.space.xl,
        paddingRight: T.space.xl,
        paddingTop: T.space.lg,
        paddingBottom: T.space.lg,
        gap: T.space.xl,
        backgroundColor: T.raised,
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
              Stays out of the chat. Stored securely, never shown to an automaton.
            </div>
            <textarea
              testId="settings-key-input"
              value={draft}
              placeholder="Paste the key here, not in chat"
              minRows={1}
              maxRows={2}
              theme={CHAT_THEME}
              style={FIELD_STYLE}
              onChange={(event) => setDraft(event.value ?? '')}
            />
            <div testId="settings-key-save" style={SAVE_STYLE} onClick={saveKey}>
              Save securely
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: T.space.md,
              }}
            >
              <div style={{ fontSize: T.type.sm, color: T.secondary }}>Model</div>
              <div testId="settings-model" style={{ fontSize: T.type.sm, color: T.text }}>
                {modelDraft.trim() || seatModel()}
              </div>
            </div>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
              All seats use this OpenRouter id. Search the live catalog.
            </div>
            <Combobox
              items={ids}
              value={modelDraft}
              onValueChange={(value) => {
                if (typeof value === 'string') pickModel(value)
              }}
            >
              <ComboboxInput
                testId="settings-model-input"
                placeholder="Search models"
                theme={CHAT_THEME}
                style={FIELD_STYLE}
              />
              <ComboboxContent
                testId="settings-model-menu"
                style={{
                  maxHeight: T.layout.menuMax,
                  overflowY: 'scroll',
                  backgroundColor: T.raised,
                  borderWidth: T.stroke.hairline,
                  borderColor: T.border,
                  borderRadius: T.radius.sm,
                  paddingTop: T.space.xs,
                  paddingBottom: T.space.xs,
                }}
              >
                <ComboboxList>
                  {(item) => {
                    const row = catalog.find((entry) => entry.id === item)
                    return (
                      <ComboboxItem
                        key={item}
                        value={item}
                        testId={`settings-model-item-${item}`}
                        style={(state) => ({
                          ...ITEM_PAD,
                          backgroundColor: state.highlighted || state.selected ? T.inverse : T.clear,
                          color: state.highlighted || state.selected ? T.onInverse : T.text,
                        })}
                      >
                        {row?.name && row.name !== item ? `${row.name} · ${item}` : item}
                      </ComboboxItem>
                    )
                  }}
                </ComboboxList>
                <ComboboxEmpty style={{ ...ITEM_PAD, color: T.tertiary }}>No matching model</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
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
      <Section title="Computer">
        <div testId="settings-computer" style={{ fontSize: T.type.sm, color: T.text }}>
          {computerLabel(boxStatus())}
        </div>
      </Section>
    </div>
  )
}

const SAVE_STYLE = {
  alignSelf: 'flex-start' as const,
  paddingLeft: T.space.md,
  paddingRight: T.space.md,
  paddingTop: T.space.xs,
  paddingBottom: T.space.xs,
  borderRadius: T.radius.sm,
  backgroundColor: T.raised,
  fontSize: T.type.sm,
  color: T.text,
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}
