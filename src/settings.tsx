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
import { probeConnector, type CatalogModel } from './runtime/connector-client'
import {
  connectorStatusLabel,
  defaultOpenRouter,
  hasOpenRouterGrant,
  OPENROUTER_ID,
  readConnectors,
  writeConnectorSecret,
  type Connector,
} from './runtime/connectors'
import { listOpenRouterKeys } from './runtime/keys'
import {
  listModelsForProvider,
  listProviders,
  providerPickerLabel,
  providerStatusLabel,
  PROVIDERS_DOCS,
} from './runtime/providers'
import { boxStatus, computerLabel } from './runtime/box'
import { aboutVersionLines } from './runtime/version'
import { mouthModelFor, seatModel, writeSeatBinding } from './runtime/plane'
import { clampFrostWash, patchSkin, readSkin, type Skin, type WindowMode } from './runtime/skin'
import {
  BRAND_ACCENT_SWATCHES,
  BRAND_RADIUS_PRESETS,
  BRAND_TINT_SWATCHES,
  tokensFromSkin,
  useTokenEnv,
} from './theme'
import type { LedgerMetrics } from './runtime/store'
import type { Agent } from './domain'
import { visibleAgents } from './domain'
import { CLIP, Chip, menuItemStyle, modelFamily, useChrome } from './ui'
import { MaskedSecretField } from './cards'
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  pauseRoutine,
  resumeRoutine,
  scheduleOrTriggerSummary,
  type Routine,
} from './runtime/routines'
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkillBody,
  setSkillEnabled,
  updateSkill,
  type SkillMeta,
} from './runtime/skills'
import { readProfile, writeProfile } from './runtime/profile'
import {
  channelStatusLabel,
  connectSlack,
  disconnectChannel,
  hasSlackGrant,
  slackStatus,
  type Channel,
} from './runtime/channels'

import {
  archiveRoom,
  createRoom,
  deleteRoom,
  listRooms,
  updateRoomMembers,
  type Room,
} from './runtime/rooms'
import {
  installMcp,
  listCatalog,
  mcpStatusLabel,
  uninstallMcp,
  type CatalogEntryStatus,
} from './runtime/mcp-catalog'
import { CloudOriginPanel } from './cloud-origin-panel'
import { githubUrlFromHomeRepo, readExplicitOriginRemote } from './runtime/cloud-origin'

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
  const { tokens: T } = useChrome()
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
  const chrome = useChrome()
  const T = chrome.tokens
  const { replace } = useTokenEnv()
  const [skin, setSkin] = useState<Skin>(() => readSkin())
  const pick = (patch: Partial<Skin>) => {
    const next = patchSkin(patch)
    replace(tokensFromSkin(next))
    setSkin(next)
    onSkinChange?.()
  }
  const mode = (windowMode: WindowMode) => () => pick({ windowMode })
  const pickBrand = (patch: Partial<Skin['brand']>) => pick({ brand: { ...skin.brand, ...patch } })
  return (
    <div testId="settings-window" style={{ ...chrome.card }}>
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
      <div testId="settings-brand" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>Brand</div>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>Tint</div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs, flexWrap: 'wrap' }}>
          {BRAND_TINT_SWATCHES.map((swatch) => (
            <Chip
              key={swatch.id}
              testId={`settings-brand-tint-${swatch.id}`}
              tone={skin.brand.tint === swatch.hex ? 'action' : 'ghost'}
              onClick={() => pickBrand({ tint: swatch.hex })}
            >
              {swatch.id}
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>Accent</div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs, flexWrap: 'wrap' }}>
          {BRAND_ACCENT_SWATCHES.map((swatch) => (
            <Chip
              key={swatch.id}
              testId={`settings-brand-accent-${swatch.id}`}
              tone={skin.brand.accent === swatch.hex ? 'action' : 'ghost'}
              onClick={() => pickBrand({ accent: swatch.hex })}
            >
              {swatch.id}
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>Radius</div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs, flexWrap: 'wrap' }}>
          {BRAND_RADIUS_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              testId={`settings-brand-radius-${preset.id}`}
              tone={skin.brand.radius === preset.radius ? 'action' : 'ghost'}
              onClick={() => pickBrand({ radius: preset.radius })}
            >
              {preset.id}
            </Chip>
          ))}
        </div>
      </div>
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
  const chrome = useChrome()
  const T = chrome.tokens
  return (
    <div testId={`settings-seat-${agent.id}`} style={{ ...chrome.card }}>
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
          theme={chrome.fieldTheme}
          style={chrome.fieldLine}
        />
        <ComboboxContent
          testId={index === 0 ? 'settings-model-menu' : `settings-seat-${agent.id}-menu`}
          style={chrome.menu}
        >
          <ComboboxList>
            {(item) => {
              const row = catalog.find((entry) => entry.id === item)
              return (
                <ComboboxItem
                  key={item}
                  value={item}
                  testId={index === 0 ? `settings-model-item-${item}` : `settings-seat-${agent.id}-item-${item}`}
                  style={(state) => menuItemStyle(state, T)}
                >
                  {row?.name && row.name !== item ? `${row.name} · ${item}` : item}
                </ComboboxItem>
              )
            }}
          </ComboboxList>
          <ComboboxEmpty style={{ ...chrome.itemPad, color: T.tertiary }}>No matching model</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      {note ? <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{note}</div> : null}
    </div>
  )
}


function formatLastRun(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return 'never'
  return at.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: true })
}

function RoutinesCard({ agents }: { agents: Agent[] }) {
  const chrome = useChrome()
  const T = chrome.tokens
  const defaultAgent = agents.find((row) => row.id === 'staff')?.id ?? agents[0]?.id ?? 'staff'
  const [rows, setRows] = useState<Routine[]>(() => listRoutines())
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState('@daily')
  const [note, setNote] = useState('')
  const refresh = () => setRows(listRoutines())
  const create = () => {
    const n = name.trim()
    const p = prompt.trim()
    const s = schedule.trim()
    if (!n || !p || !s) {
      setNote('Name, prompt, and schedule required.')
      return
    }
    try {
      createRoutine({ agentId: defaultAgent, name: n, prompt: p, schedule: s })
      setName('')
      setPrompt('')
      setSchedule('@daily')
      setNote('')
      refresh()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not create routine.')
    }
  }
  return (
    <div testId="settings-routines" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      {rows.length === 0 ? (
        <div style={{ ...chrome.card, fontSize: T.type.sm, color: T.secondary }}>
          No routines yet. Schedule wakes a mouth with a saved prompt while Staff is open.
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={`${row.agentId}:${row.id}`}
            testId={`settings-routine-${row.id}`}
            style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.xs }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md }}>
              <div style={{ fontSize: T.type.sm, color: T.text }}>{row.name}</div>
              <div style={{ fontSize: T.type.xs, color: T.secondary }}>
                {row.enabled ? 'on' : 'paused'}
                {row.trigger ? ` · ${row.trigger.type}` : ' · schedule'}
              </div>
            </div>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
              {scheduleOrTriggerSummary(row)} · last {formatLastRun(row.lastRunAt)}
            </div>
            {row.lastError ? (
              <div style={{ fontSize: T.type.xs, color: T.secondary }}>{row.lastError}</div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
              {row.enabled ? (
                <Chip
                  testId={`settings-routine-${row.id}-pause`}
                  tone="ghost"
                  onClick={() => {
                    pauseRoutine(row.agentId, row.id)
                    refresh()
                  }}
                >
                  Pause
                </Chip>
              ) : (
                <Chip
                  testId={`settings-routine-${row.id}-resume`}
                  tone="ghost"
                  onClick={() => {
                    resumeRoutine(row.agentId, row.id)
                    refresh()
                  }}
                >
                  Resume
                </Chip>
              )}
              <Chip
                testId={`settings-routine-${row.id}-delete`}
                tone="ghost"
                onClick={() => {
                  deleteRoutine(row.agentId, row.id)
                  refresh()
                }}
              >
                Delete
              </Chip>
            </div>
          </div>
        ))
      )}
      <div testId="settings-routines-create" style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
          Cron, @daily (weekdays 9:00 CT), or @hourly. Event triggers (GitHub / Slack / webhook) are documented in docs — prefer those over inventing PR/CI polls.
        </div>
        <textarea
          testId="settings-routine-name"
          value={name}
          placeholder="Name"
          minRows={1}
          maxRows={1}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setName(event.value ?? '')}
        />
        <textarea
          testId="settings-routine-prompt"
          value={prompt}
          placeholder="Prompt / intent"
          minRows={2}
          maxRows={4}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setPrompt(event.value ?? '')}
        />
        <textarea
          testId="settings-routine-schedule"
          value={schedule}
          placeholder="@daily or cron"
          minRows={1}
          maxRows={1}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setSchedule(event.value ?? '')}
        />
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, alignItems: 'center' }}>
          <Chip testId="settings-routine-create" tone="action" onClick={create}>
            Add routine
          </Chip>
          {note ? <div style={{ fontSize: T.type.xs, color: T.secondary }}>{note}</div> : null}
        </div>
      </div>
    </div>
  )
}



function SkillsCard({ agents }: { agents: Agent[] }) {
  const chrome = useChrome()
  const T = chrome.tokens
  const pinAgentId = agents.find((row) => row.id === 'staff')?.id ?? agents[0]?.id ?? 'staff'
  const [rows, setRows] = useState<SkillMeta[]>(() => listSkills())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBody, setEditBody] = useState('')
  const [note, setNote] = useState('')
  const [profileSkillIds, setProfileSkillIds] = useState<string[]>(() => readProfile(pinAgentId)?.skillIds ?? [])
  const refresh = () => {
    setRows(listSkills())
    setProfileSkillIds(readProfile(pinAgentId)?.skillIds ?? [])
  }
  const selected = rows.find((row) => row.id === selectedId) ?? null
  const openSkill = (id: string) => {
    try {
      const skill = rows.find((row) => row.id === id) ?? listSkills().find((row) => row.id === id)
      if (!skill) {
        setNote(`Need: unknown skill ${id}.`)
        setSelectedId(null)
        return
      }
      const markdownBody = readSkillBody(id)
      setSelectedId(id)
      setEditName(skill.name)
      setEditDescription(skill.description)
      setEditBody(markdownBody)
      setNote('')
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'unknown skill')
      setSelectedId(null)
    }
  }
  const create = () => {
    const n = name.trim()
    const d = description.trim()
    const b = body
    if (!n || !d || !b.trim()) {
      setNote('Name, description (use this when …), and body required.')
      return
    }
    try {
      const skill = createSkill({ name: n, description: d, body: b })
      setName('')
      setDescription('')
      setBody('')
      setNote('')
      refresh()
      openSkill(skill.id)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not create skill.')
    }
  }
  const saveEdit = () => {
    if (!selected || selected.origin !== 'local') return
    try {
      updateSkill(selected.id, {
        name: editName,
        description: editDescription,
        body: editBody,
      })
      setNote('')
      refresh()
      openSkill(selected.id)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not update skill.')
    }
  }
  const togglePin = (id: string) => {
    const profile = readProfile(pinAgentId)
    if (!profile) {
      setNote(`Need: no profile for ${pinAgentId}.`)
      return
    }
    const pinned = profile.skillIds.includes(id)
    writeProfile({
      ...profile,
      skillIds: pinned ? profile.skillIds.filter((row) => row !== id) : [...profile.skillIds, id],
    })
    refresh()
  }
  const remove = (id: string) => {
    try {
      deleteSkill(id)
      if (selectedId === id) setSelectedId(null)
      setNote('')
      refresh()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not delete skill.')
    }
  }
  return (
    <div testId="settings-skills" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      {rows.length === 0 ? (
        <div testId="settings-skills-empty" style={{ ...chrome.card, fontSize: T.type.sm, color: T.secondary }}>
          No skills yet. Author a local skill below, or import a SKILL.md URL from the inspector.
        </div>
      ) : (
        rows.map((row) => {
          const pinned = profileSkillIds.includes(row.id)
          const disabled = row.origin === 'imported' && !row.enabled
          return (
            <div
              key={row.id}
              testId={`settings-skill-${row.id}`}
              style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.xs }}
            >
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md }}>
                <div style={{ fontSize: T.type.sm, color: T.text }}>
                  {row.name}
                  <span style={{ color: T.tertiary }}> · {row.id}</span>
                </div>
                <div style={{ fontSize: T.type.xs, color: T.secondary }}>
                  {row.origin}
                  {disabled ? ' · disabled' : ''}
                  {pinned ? ' · pinned' : ''}
                </div>
              </div>
              <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
                {row.description.trim() || 'No use-when description'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
                <Chip testId={`settings-skill-${row.id}-open`} tone="ghost" onClick={() => openSkill(row.id)}>
                  Open
                </Chip>
                <Chip
                  testId={`settings-skill-${row.id}-pin`}
                  tone={pinned ? 'action' : 'ghost'}
                  onClick={() => togglePin(row.id)}
                >
                  {pinned ? 'Unpin' : 'Pin'}
                </Chip>
                {row.origin === 'imported' ? (
                  <Chip
                    testId={`settings-skill-${row.id}-enable`}
                    tone="ghost"
                    onClick={() => {
                      setSkillEnabled(row.id, !row.enabled)
                      refresh()
                    }}
                  >
                    {row.enabled ? 'Disable' : 'Enable'}
                  </Chip>
                ) : null}
                <Chip
                  testId={`settings-skill-${row.id}-delete`}
                  tone="ghost"
                  onClick={() => remove(row.id)}
                >
                  Delete
                </Chip>
              </div>
            </div>
          )
        })
      )}
      {selected ? (
        <div
          testId="settings-skills-detail"
          style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}
        >
          <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
            {selected.origin === 'imported'
              ? 'Imported skill — body / name / description are read-only. Enable, pin, or delete.'
              : `Editing local skill ${selected.id}`}
          </div>
          <textarea
            testId="settings-skill-detail-name"
            value={editName}
            placeholder="Name"
            minRows={1}
            maxRows={1}
            theme={chrome.fieldTheme}
            style={chrome.field}
            onChange={(event) => {
              if (selected.origin === 'local') setEditName(event.value ?? '')
            }}
          />
          <textarea
            testId="settings-skill-detail-description"
            value={editDescription}
            placeholder="use this when …"
            minRows={1}
            maxRows={2}
            theme={chrome.fieldTheme}
            style={chrome.field}
            onChange={(event) => {
              if (selected.origin === 'local') setEditDescription(event.value ?? '')
            }}
          />
          <textarea
            testId="settings-skill-detail-body"
            value={editBody}
            placeholder="Markdown body"
            minRows={4}
            maxRows={12}
            theme={chrome.fieldTheme}
            style={chrome.field}
            onChange={(event) => {
              if (selected.origin === 'local') setEditBody(event.value ?? '')
            }}
          />
          {selected.origin === 'local' ? (
            <Chip testId="settings-skill-detail-save" tone="action" onClick={saveEdit}>
              Save
            </Chip>
          ) : null}
        </div>
      ) : null}
      <div
        testId="settings-skills-create"
        style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}
      >
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
          Local skills only. Description is the use-when line (required). Pin attaches by id — never a filesystem path.
          Coding still goes Jobs → Puppetmaster; mouths stay Send.
        </div>
        <textarea
          testId="settings-skill-name"
          value={name}
          placeholder="Name"
          minRows={1}
          maxRows={1}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setName(event.value ?? '')}
        />
        <textarea
          testId="settings-skill-description"
          value={description}
          placeholder="use this when …"
          minRows={1}
          maxRows={2}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setDescription(event.value ?? '')}
        />
        <textarea
          testId="settings-skill-body"
          value={body}
          placeholder="Markdown body"
          minRows={3}
          maxRows={8}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setBody(event.value ?? '')}
        />
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, alignItems: 'center' }}>
          <Chip testId="settings-skill-create" tone="action" onClick={create}>
            Add skill
          </Chip>
          {note ? (
            <div testId="settings-skills-note" style={{ fontSize: T.type.xs, color: T.secondary }}>
              {note}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}


function RoomsCard({ agents }: { agents: Agent[] }) {
  const chrome = useChrome()
  const T = chrome.tokens
  const seats = visibleAgents(agents)
  const [rows, setRows] = useState<Room[]>(() => listRooms(undefined, { includeArchived: true }))
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const agent of seats) out[agent.id] = agent.id === 'staff'
    return out
  })
  const [note, setNote] = useState('')
  const refresh = () => setRows(listRooms(undefined, { includeArchived: true }))
  const create = () => {
    const n = name.trim()
    if (!n) {
      setNote('Name required.')
      return
    }
    const memberIds = seats.filter((agent) => picked[agent.id]).map((agent) => agent.id)
    if (memberIds.length === 0) {
      setNote('Pick at least one member.')
      return
    }
    try {
      createRoom({ name: n, memberIds })
      setName('')
      setNote('')
      refresh()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not create room.')
    }
  }
  const toggleMember = (room: Room, agentId: string) => {
    const has = room.memberIds.includes(agentId)
    const memberIds = has
      ? room.memberIds.filter((id) => id !== agentId)
      : [...room.memberIds, agentId]
    updateRoomMembers(room.id, memberIds)
    refresh()
  }
  return (
    <div testId="settings-rooms" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      {rows.length === 0 ? (
        <div style={{ ...chrome.card, fontSize: T.type.sm, color: T.secondary }}>
          No rooms yet. Create a named room and seat automata — posts land as notes on each member thread.
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            testId={`settings-room-${row.id}`}
            style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.xs }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md }}>
              <div style={{ fontSize: T.type.sm, color: T.text }}>{row.name}</div>
              <div style={{ fontSize: T.type.xs, color: T.secondary }}>
                {row.archived ? 'archived' : `${row.memberIds.length} members`}
              </div>
            </div>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
              {row.memberIds
                .map((id) => seats.find((agent) => agent.id === id)?.name ?? id)
                .join(' · ') || 'no members'}
            </div>
            {!row.archived ? (
              <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
                {seats.map((agent) => {
                  const on = row.memberIds.includes(agent.id)
                  return (
                    <Chip
                      key={agent.id}
                      testId={`settings-room-${row.id}-member-${agent.id}`}
                      tone={on ? 'action' : 'ghost'}
                      onClick={() => toggleMember(row, agent.id)}
                    >
                      {on ? `✓ ${agent.name}` : agent.name}
                    </Chip>
                  )
                })}
              </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
              {!row.archived ? (
                <Chip
                  testId={`settings-room-${row.id}-archive`}
                  tone="ghost"
                  onClick={() => {
                    archiveRoom(row.id)
                    refresh()
                  }}
                >
                  Archive
                </Chip>
              ) : null}
              <Chip
                testId={`settings-room-${row.id}-delete`}
                tone="ghost"
                onClick={() => {
                  deleteRoom(row.id)
                  refresh()
                }}
              >
                Delete
              </Chip>
            </div>
          </div>
        ))
      )}
      <div testId="settings-rooms-create" style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
          Local multi-agent rooms (not Slack). Each member keeps their own thread; posts fan as agent notes.
        </div>
        <textarea
          testId="settings-room-name"
          value={name}
          placeholder="Room name"
          minRows={1}
          maxRows={1}
          theme={chrome.fieldTheme}
          style={chrome.field}
          onChange={(event) => setName(event.value ?? '')}
        />
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
          {seats.map((agent) => (
            <Chip
              key={agent.id}
              testId={`settings-room-pick-${agent.id}`}
              tone={picked[agent.id] ? 'action' : 'ghost'}
              onClick={() => setPicked((cur) => ({ ...cur, [agent.id]: !cur[agent.id] }))}
            >
              {picked[agent.id] ? `✓ ${agent.name}` : agent.name}
            </Chip>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, alignItems: 'center' }}>
          <Chip testId="settings-room-create" tone="action" onClick={create}>
            Add room
          </Chip>
          {note ? <div style={{ fontSize: T.type.xs, color: T.secondary }}>{note}</div> : null}
        </div>
      </div>
    </div>
  )
}


function McpCatalogCard() {
  const chrome = useChrome()
  const T = chrome.tokens
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((n) => n + 1)
  void tick
  const rows = listCatalog({ query })
  const install = (id: string) => {
    const result = installMcp(id)
    if (!result.ok) {
      setNote(result.error)
      return
    }
    setNote('')
    refresh()
  }
  const uninstall = (id: string) => {
    const result = uninstallMcp(id)
    if (!result.ok) {
      setNote(result.error)
      return
    }
    setNote('')
    setSecretDraft((cur) => {
      const next = { ...cur }
      delete next[id]
      return next
    })
    refresh()
  }
  const connect = (id: string) => {
    const value = (secretDraft[id] ?? '').trim()
    if (!value) {
      setNote(`Need a secret for ${id}.`)
      return
    }
    if (!writeConnectorSecret(id, value)) {
      setNote(`Need: could not save auth for ${id}.`)
      return
    }
    setSecretDraft((cur) => {
      const next = { ...cur }
      delete next[id]
      return next
    })
    setNote('')
    refresh()
  }
  const statusTone = (status: CatalogEntryStatus): 'action' | 'ghost' =>
    status === 'installed' ? 'action' : 'ghost'
  return (
    <div testId="settings-mcp-catalog" style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Curated MCP connectors (install registry under ~/.automaton/mcp). OpenRouter stays in Connectors above — mouth HTTP, not MCP. Auth uses the same secret-request / Connect path (never paste in chat). Live tool call is stubbed; discoverTools returns schema hints.
      </div>
      <textarea
        testId="settings-mcp-search"
        value={query}
        placeholder="Search catalog"
        minRows={1}
        maxRows={1}
        theme={chrome.fieldTheme}
        style={chrome.field}
        onChange={(event) => setQuery(event.value ?? '')}
      />
      {rows.length === 0 ? (
        <div testId="settings-mcp-empty" style={{ ...chrome.card, fontSize: T.type.sm, color: T.secondary }}>
          Need: no catalog entries match. (Curated list only — never invent plugins.)
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            testId={`settings-mcp-${row.id}`}
            style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.xs }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md }}>
              <div style={{ fontSize: T.type.sm, color: T.text }}>{row.name}</div>
              <Chip testId={`settings-mcp-${row.id}-status`} tone={statusTone(row.status)}>
                {mcpStatusLabel(row.status)}
              </Chip>
            </div>
            <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{row.description}</div>
            {row.package ? (
              <div style={{ fontSize: T.type.xs, color: T.secondary }}>{row.package}</div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, flexWrap: 'wrap' }}>
              {row.status === 'available' || row.status === 'error' ? (
                <Chip testId={`settings-mcp-${row.id}-install`} tone="action" onClick={() => install(row.id)}>
                  Install
                </Chip>
              ) : (
                <Chip testId={`settings-mcp-${row.id}-uninstall`} tone="ghost" onClick={() => uninstall(row.id)}>
                  Uninstall
                </Chip>
              )}
            </div>
            {row.status === 'needsAuth' || (row.needsAuth && row.status === 'installed') ? (
              <div
                testId={`settings-mcp-${row.id}-connect`}
                style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}
              >
                <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
                  Connect — stays out of chat. Same vault path as connector secret-request.
                </div>
                {row.status === 'needsAuth' ? (
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
                    <MaskedSecretField
                      testId={`settings-mcp-${row.id}-secret`}
                      value={secretDraft[row.id] ?? ''}
                      placeholder="Enter key — stays out of chat"
                      theme={chrome.fieldTheme}
                      style={{ ...chrome.field, flexGrow: 1 }}
                      onChange={(next) => setSecretDraft((cur) => ({ ...cur, [row.id]: next }))}
                    />
                    <Chip testId={`settings-mcp-${row.id}-connect-save`} tone="action" onClick={() => connect(row.id)}>
                      Connect
                    </Chip>
                  </div>
                ) : (
                  <div style={{ fontSize: T.type.xs, color: T.secondary }}>Configured</div>
                )}
              </div>
            ) : null}
          </div>
        ))
      )}
      {note ? (
        <div testId="settings-mcp-note" style={{ fontSize: T.type.xs, color: T.secondary }}>
          {note}
        </div>
      ) : null}
    </div>
  )
}


function AboutCard() {
  const chrome = useChrome()
  const T = chrome.tokens
  const about = aboutVersionLines()
  const plistLabel = about.plist
    ? about.aligned
      ? `Info.plist ${about.plist} · match`
      : `Info.plist ${about.plist} · WARN drift`
    : 'Info.plist missing'
  return (
    <div testId="settings-about" style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: T.space.md,
        }}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>Installed</div>
        <div testId="settings-about-installed" style={{ fontSize: T.type.sm, color: T.text }}>
          {about.installed}
        </div>
      </div>
      <div
        testId="settings-about-plist"
        style={{ fontSize: T.type.xs, color: about.aligned ? T.tertiary : T.danger }}
      >
        {plistLabel}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: T.space.md,
        }}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>Latest release</div>
        <div testId="settings-about-latest" style={{ fontSize: T.type.sm, color: T.text }}>
          {about.latestLine}
        </div>
      </div>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Notify only — Update is always a click. No PyPI; version stays with package until the next band cut.
      </div>
    </div>
  )
}

export function Settings({
  metrics,
  agents = [],
  onClose,
  onPlaneChange,
  onSkinChange,
  onCompactNow,
}: {
  metrics: LedgerMetrics
  agents?: Agent[]
  onClose: () => void
  onPlaneChange?: () => void
  onSkinChange?: () => void
  /** Mouth-only compact for the focused automaton. Jobs strip untouched. */
  onCompactNow?: () => void
}) {
  const chrome = useChrome()
  const T = chrome.tokens
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
  const [slack, setSlack] = useState<Channel>(() => slackStatus())
  const [slackDraft, setSlackDraft] = useState('')
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
    void listModelsForProvider(OPENROUTER_ID)
      .then((rows) => {
        if (!rows) return
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
    void listModelsForProvider(OPENROUTER_ID).then((rows) => {
      if (cancelled || !rows) return
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
    // Same vault path as mouth secret-request / fulfillSecretRequest.
    if (!writeConnectorSecret(OPENROUTER_ID, key)) return
    setDraft('')
    setPresence('present')
    if (!shouldLiveProbe()) return
    void probeConnector(OPENROUTER_ID).then(setOpenRouter)
    loadCatalog()
  }
  const saveSlack = () => {
    const token = slackDraft.trim()
    if (!token) return
    const row = connectSlack({ botToken: token })
    setSlackDraft('')
    setSlack(row)
  }
  const dropSlack = () => {
    const row = disconnectChannel('slack')
    setSlack(row ?? slackStatus())
    setSlackDraft('')
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
              OpenRouter · mouth (live) — one model per agent. keys stay on your machine.
            </div>
          </div>
          <PaneHeader title="" onClose={onClose} closeId="settings-close" />
        </div>
        <WindowCard onSkinChange={onSkinChange} />
        <div testId="settings-keys" style={{ ...chrome.card }}>
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
              <MaskedSecretField
                testId="settings-key-input"
                value={draft}
                placeholder="Enter key — stays out of chat"
                theme={chrome.fieldTheme}
                style={{ ...chrome.field, flexGrow: 1 }}
                onChange={setDraft}
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
          <div style={chrome.card}>
            <LedgerList metrics={metrics} testId="settings-usage" />
          </div>
        </Section>
        <Section title="Mouth context">
          <div testId="settings-compact" style={chrome.card}>
            <div style={{ fontSize: T.type.xs, color: T.tertiary, marginBottom: T.space.sm }}>
              Working set is a compact summary plus recent turns — not the full transcript. Jobs /
              Puppetmaster artifacts stay on the Jobs strip. Auto-compacts when over the char
              budget; fail-soft keeps the prior set.
            </div>
            <Chip
              testId="settings-compact-now"
              tone="action"
              onClick={() => onCompactNow?.()}
            >
              Compact now
            </Chip>
          </div>
        </Section>
        <Section title="Connectors">
          <div testId="settings-connectors" style={chrome.card}>
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
            <div style={{ fontSize: T.type.xs, color: T.tertiary, marginTop: T.space.sm }}>
              OpenRouter is the live mouth HTTP provider (and default Jobs provider). See Providers
              below — Jobs/PM and cloud rows are honesty labels, not fake selects. MCP plugins live
              in the MCP catalog.
            </div>
          </div>
        </Section>
        <Section title="Providers">
          <div testId="settings-providers" style={chrome.card}>
            <div style={{ fontSize: T.type.xs, color: T.tertiary, marginBottom: T.space.sm }}>
              Product map ({PROVIDERS_DOCS}). Unknown provider = miss. Codex Jobs use Codex auth
              only — never OPENAI_API_KEY.
            </div>
            {listProviders().map((row) => (
              <div
                key={row.id}
                testId={`settings-provider-${row.id}`}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: T.space.md,
                  marginTop: T.space.xs,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs, minWidth: 0 }}>
                  <div style={{ fontSize: T.type.sm, color: T.text }}>{providerPickerLabel(row)}</div>
                  <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{row.auth.storeHint}</div>
                </div>
                <div
                  testId={`settings-provider-${row.id}-status`}
                  style={{ fontSize: T.type.sm, color: T.secondary, flexShrink: 0 }}
                >
                  {providerStatusLabel(row)}
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="MCP catalog">
          <McpCatalogCard />
        </Section>
        <Section title="Channels">
          <div testId="settings-channels" style={chrome.card}>
            <div
              testId="channel-slack"
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
                <div style={{ fontSize: T.type.sm, color: T.text }}>Slack</div>
                <div style={{ fontSize: T.type.sm, color: T.secondary }}>
                  {channelStatusLabel(slack)}
                </div>
              </div>
              <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
                Mentions and DMs wake Staff. Token stays out of chat — same vault as OpenRouter.
              </div>
              {slack.connected && hasSlackGrant() ? (
                <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
                  <Chip testId="settings-slack-disconnect" tone="ghost" onClick={dropSlack}>
                    Disconnect
                  </Chip>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
                  <MaskedSecretField
                    testId="settings-slack-token"
                    value={slackDraft}
                    placeholder="Enter key — stays out of chat"
                    theme={chrome.fieldTheme}
                    style={{ ...chrome.field, flexGrow: 1 }}
                    onChange={setSlackDraft}
                  />
                  <Chip testId="settings-slack-connect" tone="action" onClick={saveSlack}>
                    Connect
                  </Chip>
                </div>
              )}
              {slack.lastError ? (
                <div style={{ fontSize: T.type.xs, color: T.danger }}>{slack.lastError}</div>
              ) : null}
            </div>
          </div>
        </Section>
        <Section title="Rooms">
          <RoomsCard agents={seats} />
        </Section>
        <Section title="Routines">
          <RoutinesCard agents={seats} />
        </Section>
        <Section title="Skills">
          <SkillsCard agents={seats} />
        </Section>
        <Section title="Computer">
          <div testId="settings-computer" style={{ ...chrome.card, fontSize: T.type.sm, color: T.text }}>
            {computerLabel(boxStatus())}
          </div>
        </Section>

        <Section title="Cloud / Origin">
          <CloudOriginPanel
            mode="settings"
            bindRepository={
              (() => {
                for (const agent of seats) {
                  const profile = readProfile(agent.id)
                  const url = profile?.homeRepo ? githubUrlFromHomeRepo(profile.homeRepo) : null
                  if (url) return url
                }
                return undefined
              })()
            }
            bindLabel={
              (() => {
                for (const agent of seats) {
                  const profile = readProfile(agent.id)
                  if (profile?.homeRepo) return profile.homeRepo
                }
                return undefined
              })()
            }
            originRemote={
              (() => {
                for (const agent of seats) {
                  const path = readProfile(agent.id)?.homePath?.trim()
                  if (!path) continue
                  const origin = readExplicitOriginRemote(path)
                  if (origin) return origin
                }
                return undefined
              })()
            }
          />
        </Section>

        <Section title="About">
          <AboutCard />
        </Section>
      </div>
    </div>
  )
}
