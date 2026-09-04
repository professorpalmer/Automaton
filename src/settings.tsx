import React, { useEffect, useRef, useState } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useGpuix,
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
import { mouthModelFor, seatModel, writeSeatBinding } from './runtime/plane'
import {
  applyChromeToTokens,
  clampFrostWash,
  patchSkin,
  readSkin,
  type Skin,
  type WindowMode,
} from './runtime/skin'
import type { LedgerMetrics } from './runtime/store'
import type { Agent } from './domain'
import { visibleAgents } from './domain'
import { CARD_STYLE, CLIP, Chip, FIELD_LINE_STYLE, FIELD_STYLE, ITEM_PAD, MENU_STYLE, menuItemStyle, modelFamily } from './ui'
import { CHAT_THEME, FIELD_THEME, T } from './tokens'

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

function pinForSeat(id: string): string {
  return mouthModelFor(id)
}

function WashSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  const bar = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const drag = useRef(false)
  const applyAt = (x?: number) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || !bar.current) return
    const box = renderer.getElementBounds(bar.current.id)
    if (!box || box.length < 4 || !box[2]) return
    const t = (x - box[0]) / box[2]
    onChange(clampFrostWash(t * 100))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>Light</div>
        <div testId="settings-window-wash-value" style={{ fontSize: T.type.xs, color: T.secondary }}>
          {value}
        </div>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>Heavy</div>
      </div>
      <div
        ref={bar}
        testId="settings-window-wash"
        style={{
          height: 16,
          borderRadius: T.radius.pill,
          backgroundColor: T.selected,
          justifyContent: 'center',
          cursor: 'pointer',
        }}
        onMouseDown={(event) => {
          drag.current = true
          applyAt(event.x)
        }}
        onMouseMove={(event) => {
          if (drag.current) applyAt(event.x)
        }}
        onMouseUp={() => {
          drag.current = false
        }}
      >
        <div
          style={{
            width: `${Math.max(8, value)}%`,
            height: 6,
            marginLeft: T.space.xs,
            marginRight: T.space.xs,
            borderRadius: T.radius.pill,
            backgroundColor: T.accent,
          }}
        />
      </div>
    </div>
  )
}

function WindowCard({
  onSkinChange,
}: {
  onSkinChange?: () => void
}) {
  const [skin, setSkin] = useState<Skin>(() => readSkin())
  const pick = (patch: Partial<Skin>) => {
    const next = patchSkin(patch)
    applyChromeToTokens(next)
    setSkin(next)
    onSkinChange?.()
  }
  const mode = (windowMode: WindowMode) => () => pick({ windowMode })
  return (
    <div testId="settings-window" style={{ ...CARD_STYLE }}>
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>Window</div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
        <Chip
          testId="settings-window-frosted"
          tone={skin.windowMode === 'frosted' ? 'action' : 'ghost'}
          onClick={mode('frosted')}
        >
          Frosted
        </Chip>
        <Chip
          testId="settings-window-solid"
          tone={skin.windowMode === 'solid' ? 'action' : 'ghost'}
          onClick={mode('solid')}
        >
          Solid
        </Chip>
      </div>
      {skin.windowMode === 'frosted' ? (
        <WashSlider value={skin.frostWash} onChange={(frostWash) => pick({ frostWash })} />
      ) : null}
    </div>
  )
}

function SeatCard({
  agent,
  index,
  pin,
  note,
  ids,
  catalog,
  loadCatalog,
  pickModel,
  testSeat,
}: {
  agent: Agent
  index: number
  pin: string
  note: string | null
  ids: string[]
  catalog: CatalogModel[]
  loadCatalog: () => void
  pickModel: (seatId: string, value: string) => void
  testSeat: (seatId: string) => void
}) {
  return (
    <div testId={`settings-seat-${agent.id}`} style={{ ...CARD_STYLE }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: T.space.md,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs, minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: T.type.md, color: T.text, ...CLIP }}>{agent.name}</div>
          <div style={{ fontSize: T.type.xs, color: T.tertiary, ...CLIP }}>
            {agent.title || 'automaton'} · {modelFamily(pin)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs, flexShrink: 0 }}>
          <Chip testId={`settings-seat-${agent.id}-catalog`} tone="ghost" onClick={loadCatalog}>
            catalog
          </Chip>
          <Chip testId={`settings-seat-${agent.id}-test`} tone="ghost" onClick={() => testSeat(agent.id)}>
            test
          </Chip>
        </div>
      </div>
      <Combobox
        items={ids}
        value={pin}
        onValueChange={(value) => {
          if (typeof value === 'string') pickModel(agent.id, value)
        }}
      >
        <ComboboxInput
          testId={index === 0 ? 'settings-model-input' : `settings-seat-${agent.id}-model`}
          placeholder="Search models"
          theme={FIELD_THEME}
          style={FIELD_LINE_STYLE}
        />
        <ComboboxContent
          testId={index === 0 ? 'settings-model-menu' : `settings-seat-${agent.id}-menu`}
          style={MENU_STYLE}
        >
          <ComboboxList>
            {(item) => {
              const row = catalog.find((entry) => entry.id === item)
              return (
                <ComboboxItem
                  key={item}
                  value={item}
                  testId={index === 0 ? `settings-model-item-${item}` : `settings-seat-${agent.id}-item-${item}`}
                  style={(state) => menuItemStyle(state)}
                >
                  {row?.name && row.name !== item ? `${row.name} · ${item}` : item}
                </ComboboxItem>
              )
            }}
          </ComboboxList>
          <ComboboxEmpty style={{ ...ITEM_PAD, color: T.tertiary }}>No matching model</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      {note ? <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{note}</div> : null}
    </div>
  )
}

export function Settings({
  metrics,
  agents = [],
  onClose,
  onPlaneChange,
  onSkinChange,
}: {
  metrics: LedgerMetrics
  agents?: Agent[]
  onClose: () => void
  onPlaneChange?: () => void
  onSkinChange?: () => void
}) {
  const seats = visibleAgents(agents)
  const chief = seats.find((agent) => agent.id === 'staff')
  const others = seats.filter((agent) => agent.id !== 'staff')
  const [moreOpen, setMoreOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pins, setPins] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const agent of seats) out[agent.id] = pinForSeat(agent.id)
    return out
  })
  const [presence, setPresence] = useState(openRouterPresence)
  const [openRouter, setOpenRouter] = useState(openRouterRow)
  const [probeNote, setProbeNote] = useState<{ id: string; text: string } | null>(null)
  const [catalog, setCatalog] = useState<CatalogModel[]>(() => {
    const rows: CatalogModel[] = []
    for (const agent of seats) {
      const pin = pinForSeat(agent.id)
      if (pin && !rows.some((row) => row.id === pin)) rows.push({ id: pin, name: pin })
    }
    const fallback = seatModel()
    return withPin(rows, fallback)
  })
  useEffect(() => {
    setPins((current) => {
      const next = { ...current }
      let changed = false
      for (const agent of seats) {
        if (!next[agent.id]) {
          next[agent.id] = pinForSeat(agent.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [seats.map((agent) => agent.id).join('|')])
  const loadCatalog = () => {
    if (!shouldLiveProbe()) return
    void listOpenRouterModels()
      .then((rows) => {
        let next = rows
        for (const pin of Object.values(pins)) next = withPin(next, pin)
        setCatalog(withPin(next, seatModel()))
      })
      .catch(() => {
        /* fail closed — keep the pin */
      })
  }
  useEffect(() => {
    if (!shouldLiveProbe()) return
    let cancelled = false
    void probeConnector(OPENROUTER_ID).then((row) => {
      if (!cancelled) setOpenRouter(row)
    })
    void listOpenRouterModels().then((rows) => {
      if (cancelled) return
      let next = rows
      for (const agent of seats) next = withPin(next, pinForSeat(agent.id))
      setCatalog(withPin(next, seatModel()))
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
  const pickModel = (seatId: string, value: string) => {
    const model = value.trim()
    if (!model) return
    writeSeatBinding(seatId, { model })
    setPins((current) => ({ ...current, [seatId]: model }))
    setCatalog((current) => withPin(current, model))
    onPlaneChange?.()
  }
  const testSeat = (seatId: string) => {
    setProbeNote({ id: seatId, text: 'testing' })
    void probeConnector(OPENROUTER_ID)
      .then((row) => {
        setOpenRouter(row)
        setProbeNote({ id: seatId, text: connectorStatusLabel(row) })
        if (!row.connected) return
        loadCatalog()
      })
      .catch(() => {
        setProbeNote({ id: seatId, text: 'Unreachable' })
      })
  }
  const ids = catalog.map((row) => row.id)
  const seatProps = {
    ids,
    catalog,
    loadCatalog,
    pickModel,
    testSeat,
  }
  const renderSeat = (agent: Agent, index: number) => (
    <SeatCard
      key={agent.id}
      agent={agent}
      index={index}
      pin={pins[agent.id] || pinForSeat(agent.id)}
      note={probeNote?.id === agent.id ? probeNote.text : null}
      {...seatProps}
    />
  )
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
        paddingTop: T.space.xl,
        paddingBottom: T.space.hero,
        backgroundColor: T.canvas,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.hero }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: T.space.md }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm, flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontSize: T.type.xl, lineHeight: T.line.xl, color: T.text }}>model picker</div>
            <div style={{ fontSize: T.type.sm, lineHeight: T.line.md, color: T.tertiary }}>
              one model per agent — pick, test, save. keys stay on your machine.
            </div>
          </div>
          <PaneHeader title="" onClose={onClose} closeId="settings-close" />
        </div>
        <WindowCard onSkinChange={onSkinChange} />
        <div testId="settings-keys" style={{ ...CARD_STYLE }}>
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
          <div testId="settings-secret-request" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
              Stays out of the chat. Stored securely, never shown to an automaton.
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
              <textarea
                testId="settings-key-input"
                value={draft}
                placeholder="Paste the key here, not in chat"
                minRows={1}
                maxRows={2}
                theme={FIELD_THEME}
                style={{ ...FIELD_STYLE, flexGrow: 1 }}
                onChange={(event) => setDraft(event.value ?? '')}
              />
              <Chip testId="settings-key-save" tone="action" onClick={saveKey}>
                Save
              </Chip>
            </div>
          </div>
        </div>
        {others.length > 0 ? (
          <Chip testId="settings-seats-more" tone="ghost" onClick={() => setMoreOpen((open) => !open)}>
            {moreOpen ? 'Hide other automata' : `Other automata · ${others.length}`}
          </Chip>
        ) : null}
        {chief ? renderSeat(chief, 0) : null}
        {moreOpen ? others.map((agent, index) => renderSeat(agent, index + 1)) : null}
        <Section title="Usage">
          <div style={CARD_STYLE}>
            <LedgerList metrics={metrics} testId="settings-usage" />
          </div>
        </Section>
        <Section title="Connectors">
          <div testId="settings-connectors" style={CARD_STYLE}>
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
              <div style={{ fontSize: T.type.sm, color: T.secondary }}>{connectorStatusLabel(openRouter)}</div>
            </div>
          </div>
        </Section>
        <Section title="Computer">
          <div testId="settings-computer" style={{ ...CARD_STYLE, fontSize: T.type.sm, color: T.text }}>
            {computerLabel(boxStatus())}
          </div>
        </Section>
      </div>
    </div>
  )
}
