import React, { useEffect, useRef, useState } from 'react'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { useGpuix, Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@gpuix/react'
import type { Agent, AgentKit } from './domain'
import type { LedgerMetrics, StaffStore } from './runtime/store'
import type { AgentProfile } from './runtime/profile'
import { boxStatus, computerLabel } from './runtime/box'
import { captureScreen } from './runtime/chrome'
import { mouthScreen } from './runtime/computer'
import { captureDesk } from './runtime/desk'
import { desktopPreview } from './runtime/desktop'
import { DEAL_HUES, DEAL_SHAPES } from './runtime/deal'
import { automatonHome } from './runtime/keys'
import { importSkillFromUrl, listSkills, setSkillEnabled } from './runtime/skills'
import type { Claim } from './runtime/working-set'
import { CHAT_THEME, T } from './tokens'
import { Chip, FIELD_STYLE, MENU_STYLE, menuItemStyle } from './ui'

const SECRET = /sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|OPENROUTER_API_KEY\s*=\s*\S+/gi
const SPOKEN_JOB = /\bjob_[A-Za-z0-9]+\b/g
const KITS: AgentKit[] = ['coordinator', 'code', 'lookup', 'blank']

export function publicClaimText(text: string): string {
  return text.replace(SECRET, '[redacted]').replace(SPOKEN_JOB, '').replace(/\s+/g, ' ').trim()
}

export function lastMouthClaims(claims: Claim[], ownerAgentId: string, limit = 3): Claim[] {
  return claims.filter((claim) => claim.ownerAgentId === ownerAgentId).slice(-limit).reverse()
}

export function computerLine(agentId: string): string {
  const screen = mouthScreen(agentId)
  return `${computerLabel(boxStatus())} · display :${screen.display}`
}

function formatUsd(n: number): string {
  if (n === 0) return '$0'
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

export function ledgerRows(metrics: LedgerMetrics): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Turns', value: String(metrics.turns) },
    { label: 'Hits', value: String(metrics.hits) },
    { label: 'Misses', value: String(metrics.misses) },
    { label: 'Avoided', value: String(metrics.inferenceAvoided) },
    { label: 'Calls', value: String(metrics.inferenceCalls) },
  ]
  if (metrics.inferenceCalls > 0 && metrics.promptTokens != null) {
    rows.push({ label: 'Prompt tokens', value: String(metrics.promptTokens) })
  }
  if (metrics.inferenceCalls > 0 && metrics.completionTokens != null) {
    rows.push({ label: 'Completion tokens', value: String(metrics.completionTokens) })
  }
  if (metrics.inferenceCalls > 0 && metrics.costUsd != null) {
    rows.push({ label: 'Cost', value: formatUsd(metrics.costUsd) })
  }
  return rows
}

export function kernelSandboxHint(agentId: string, kit?: string): string | null {
  if (agentId !== 'kernel' && kit !== 'code') return null
  const root = join(automatonHome(), 'sandboxes')
  if (!existsSync(root)) return null
  try {
    const found = readdirSync(root).some((name) => existsSync(join(root, name, '.git')))
    return found ? '~/.automaton/sandboxes/…' : null
  } catch {
    return null
  }
}

export function isStoreAnswer(store: StaffStore, userItemId: string): boolean {
  const receipt = store.receipt(userItemId)
  return receipt?.outcome === 'hit' && receipt.inferenceAvoided
}

export function inspectorChord(event: {
  key?: string
  modifiers?: { cmd?: boolean; shift?: boolean }
}): boolean {
  return event.key === 'i' && Boolean(event.modifiers?.cmd && event.modifiers?.shift)
}

export function quitChord(event: {
  key?: string
  modifiers?: { cmd?: boolean; shift?: boolean; alt?: boolean }
}): boolean {
  const key = event.key?.toLowerCase()
  return Boolean(event.modifiers?.cmd) && !event.modifiers?.shift && !event.modifiers?.alt && (key === 'q' || key === 'w')
}

export function pasteChord(event: {
  key?: string
  modifiers?: { cmd?: boolean; shift?: boolean; alt?: boolean }
}): boolean {
  return (
    event.key?.toLowerCase() === 'v' &&
    Boolean(event.modifiers?.cmd) &&
    !event.modifiers?.shift &&
    !event.modifiers?.alt
  )
}

export function LedgerList({ metrics, testId }: { metrics: LedgerMetrics; testId: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
      {ledgerRows(metrics).map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: T.space.md,
          }}
        >
          <div style={{ fontSize: T.type.sm, color: T.secondary }}>{row.label}</div>
          <div style={{ fontSize: T.type.sm, color: T.text }}>{row.value}</div>
        </div>
      ))}
    </div>
  )
}

const MARK_FIELD = FIELD_STYLE
const MARK_MENU = MENU_STYLE

function uniqueChoices(current: string, catalog: readonly string[]): string[] {
  const out: string[] = []
  for (const name of [current, ...catalog]) {
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

function passScrollTo(
  renderer: { getScrollOffset?: (id: number) => number[] | null; scrollTo?: (id: number, x: number, y: number) => void } | null,
  node: { id: number } | null,
  event: { deltaX?: number; deltaY?: number },
) {
  if (!renderer?.scrollTo || !node) return
  const dy = event.deltaY ?? 0
  if (!dy) return
  const now = renderer.getScrollOffset?.(node.id) ?? [0, 0]
  renderer.scrollTo(node.id, now[0], now[1] - dy)
}

export function Inspector({
  agent,
  profile,
  claims,
  sandboxHint,
  onClose,
  onPatch,
  controlling = false,
  onTakeControl,
}: {
  agent: Agent
  profile?: AgentProfile | null
  claims: Claim[]
  sandboxHint: string | null
  onClose: () => void
  onPatch?: (patch: Partial<AgentProfile>) => void
  controlling?: boolean
  onTakeControl?: () => void
}) {
  const ref = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const passWheel = (event: { deltaX?: number; deltaY?: number }) => passScrollTo(renderer, ref.current, event)
  const recent = lastMouthClaims(claims, agent.id)
  const kit = profile?.kit ?? 'blank'
  const preview = desktopPreview(agent.id)
  const [screen, setScreen] = useState<string | null>(preview.screen)
  const [frame, setFrame] = useState(0)
  const viewRef = useRef<{ id: number } | null>(null)
  const recapture = async () => {
    const path = captureDesk(agent.id) ?? (await captureScreen(agent.id))
    setScreen(path)
    if (path) setFrame((n) => n + 1)
  }
  useEffect(() => {
    const still = desktopPreview(agent.id)
    setScreen(still.screen)
    setFrame((n) => n + 1)
  }, [agent.id])
  const [library, setLibrary] = useState(listSkills)
  const [importUrl, setImportUrl] = useState('')
  const [importNote, setImportNote] = useState('')
  const bumpLibrary = () => setLibrary(listSkills())
  const markShapes = uniqueChoices(profile?.avatarShape ?? '', DEAL_SHAPES)
  const markHues = uniqueChoices(profile?.avatarColor ?? '', DEAL_HUES)
  return (
    <div
      ref={ref}
      testId="inspector"
      style={{
        width: T.inspector.width,
        flexShrink: 0,
        minHeight: 0,
        height: '100%',
        alignSelf: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: T.canvas,
        borderLeftWidth: T.stroke.hairline,
        borderLeftColor: T.border,
        paddingLeft: T.space.xl,
        paddingRight: T.space.xl,
        paddingTop: T.space.lg,
        paddingBottom: T.space.xl,
        gap: T.space.xl,
        overflowX: 'hidden',
        overflowY: 'scroll',
      }}
    >
      <PaneHeader title="Inspector" onClose={onClose} closeId="inspector-close" onScroll={passWheel} />
      <div testId="inspector-mouth" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
        {onPatch ? (
          <textarea
            testId="inspector-name"
            value={agent.name}
            placeholder="Name"
            minRows={1}
            maxRows={2}
            theme={CHAT_THEME}
            style={{
              width: '100%',
              fontSize: T.type.md,
              lineHeight: T.line.md,
              color: T.text,
              backgroundColor: T.composer,
              borderWidth: T.stroke.hairline,
              borderColor: T.border,
              borderRadius: T.radius.md,
              paddingLeft: T.space.md,
              paddingRight: T.space.sm,
              paddingTop: T.space.xs,
              paddingBottom: T.space.xs,
            }}
            onScroll={passWheel}
            onChange={(event) => {
              const name = (event.value ?? '').trim()
              if (name) onPatch({ name })
            }}
          />
        ) : (
          <div style={{ fontSize: T.type.md, color: T.text }}>{agent.name}</div>
        )}
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>{agent.title}</div>
        <div style={{ fontSize: T.type.sm, color: T.tertiary, lineHeight: T.line.sm }}>{agent.description}</div>
      </div>
      <Section title="Computer">
        <div testId="inspector-computer" style={{ fontSize: T.type.sm, color: T.text }}>
          {computerLine(agent.id)}
        </div>
      </Section>
      <Section title="Desktop">
        <div testId="inspector-desktop" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
          <div
            ref={viewRef}
            testId="desk-view"
            tabIndex={0}
            style={{
              width: '100%',
              height: T.desk.viewH,
              backgroundColor: T.canvas,
              borderRadius: T.radius.md,
              borderWidth: T.stroke.hairline,
              borderColor: T.border,
              overflow: 'hidden',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
            onClick={(event) => {
              if (event.isRightClick || event.button === 2) return
              void recapture()
            }}
            onScroll={passWheel}
          >
            {screen ? (
              <img
                key={frame}
                src={screen}
                objectFit="contain"
                alt=""
                style={{ width: '100%', height: T.desk.viewH, pointerEvents: 'auto' }}
                onClick={() => {
                  void recapture()
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: T.desk.viewH,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: T.type.sm,
                  color: T.tertiary,
                }}
              >
                No screen yet
              </div>
            )}
          </div>
          <div style={{ fontSize: T.type.xs, color: T.secondary }}>{`${agent.name}'s screen`}</div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm }}>
            <Chip
              testId="desk-control"
              tone={controlling ? 'primary' : 'ghost'}
              onClick={() => {
                onTakeControl?.()
                void recapture()
              }}
              onScroll={passWheel}
            >
              {controlling ? 'Release' : 'Take control'}
            </Chip>
            <Chip
              testId="desktop-refresh"
              tone="ghost"
              onClick={() => {
                void recapture()
              }}
              onScroll={passWheel}
            >
              Refresh
            </Chip>
          </div>
        </div>
      </Section>
      {profile?.homeRepo ? (
        <Section title="Home">
          <div testId="inspector-home" style={{ fontSize: T.type.sm, color: T.text }}>
            {profile.homeRepo}
          </div>
        </Section>
      ) : null}
      {profile ? (
        <Section title="Mark">
          <div testId="inspector-mark" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
            <Combobox
              items={markShapes}
              value={profile.avatarShape}
              onValueChange={(value) => {
                if (typeof value === 'string' && markShapes.includes(value) && value !== profile.avatarShape) {
                  onPatch?.({ avatarShape: value })
                }
              }}
            >
              <ComboboxInput
                testId="inspector-mark-shape"
                placeholder="Shape"
                theme={CHAT_THEME}
                style={MARK_FIELD}
                onScroll={passWheel}
              />
              <ComboboxContent testId="inspector-mark-shape-menu" style={MARK_MENU} onScroll={passWheel}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem
                      key={item}
                      value={item}
                      testId={`inspector-mark-shape-${item}`}
                      style={(state) => menuItemStyle(state)}
                    >
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Combobox
              items={markHues}
              value={profile.avatarColor}
              onValueChange={(value) => {
                if (typeof value === 'string' && markHues.includes(value) && value !== profile.avatarColor) {
                  onPatch?.({ avatarColor: value })
                }
              }}
            >
              <ComboboxInput
                testId="inspector-mark-color"
                placeholder="Color"
                theme={CHAT_THEME}
                style={MARK_FIELD}
                onScroll={passWheel}
              />
              <ComboboxContent testId="inspector-mark-color-menu" style={MARK_MENU} onScroll={passWheel}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem
                      key={item}
                      value={item}
                      testId={`inspector-mark-color-${item}`}
                      style={(state) => menuItemStyle(state)}
                    >
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </Section>
      ) : null}
      {profile ? (
        <Section title="Kit">
          <div testId="inspector-kit" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: T.space.xs }}>
            {KITS.map((item) => {
              const selected = item === kit
              return (
                <div
                  key={item}
                  testId={`kit-${item}`}
                  style={{
                    paddingLeft: T.space.sm,
                    paddingRight: T.space.sm,
                    paddingTop: T.space.xxs,
                    paddingBottom: T.space.xxs,
                    borderRadius: T.radius.sm,
                    backgroundColor: selected ? T.inverse : T.raised,
                    color: selected ? T.onInverse : T.text,
                    fontSize: T.type.xs,
                    ...HIT,
                    hover: { backgroundColor: selected ? T.inverse : T.selected },
                    active: { opacity: T.blob.active },
                  }}
                  onClick={() => onPatch?.({ kit: item })}
                  onScroll={passWheel}
                >
                  {item}
                </div>
              )
            })}
          </div>
        </Section>
      ) : null}
      {profile ? (
        <Section title="Rules">
          <textarea
            testId="inspector-rules"
            value={profile.rules}
            placeholder="Standing instructions for this automaton"
            minRows={2}
            maxRows={6}
            theme={CHAT_THEME}
            style={{
              width: '100%',
              fontSize: T.type.sm,
              lineHeight: T.line.sm,
              color: T.text,
              backgroundColor: T.composer,
              borderWidth: T.stroke.hairline,
              borderColor: T.border,
              borderRadius: T.radius.md,
              paddingLeft: T.space.md,
              paddingRight: T.space.sm,
              paddingTop: T.space.xs,
              paddingBottom: T.space.xs,
            }}
            onScroll={passWheel}
            onChange={(event) => onPatch?.({ rules: event.value ?? '' })}
          />
        </Section>
      ) : null}
      {profile ? (
        <Section title="Skills">
          <div testId="inspector-skills" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
            <textarea
              testId="skill-import-url"
              value={importUrl}
              placeholder="SKILL.md URL"
              minRows={1}
              maxRows={2}
              theme={CHAT_THEME}
              style={{
                width: '100%',
                fontSize: T.type.sm,
                lineHeight: T.line.sm,
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
              onScroll={passWheel}
              onChange={(event) => setImportUrl(event.value ?? '')}
            />
            <Chip
              testId="skill-import"
              tone="ghost"
              onClick={() => {
                const url = importUrl.trim()
                if (!url) return
                void importSkillFromUrl(url)
                  .then((result) => {
                    setImportNote(result.note)
                    setImportUrl('')
                    bumpLibrary()
                  })
                  .catch((error) => {
                    setImportNote(error instanceof Error ? error.message : 'import failed')
                  })
              }}
              onScroll={passWheel}
            >
              Import
            </Chip>
            {importNote ? (
              <div testId="skill-import-note" style={{ fontSize: T.type.xs, color: T.tertiary }}>
                {importNote}
              </div>
            ) : null}
            {library.length === 0 && profile.skillIds.length === 0 ? (
              <div style={{ fontSize: T.type.sm, color: T.tertiary }}>No skills pinned</div>
            ) : null}
            {library.map((skill) => {
              const pinned = profile.skillIds.includes(skill.id)
              const disabled = skill.origin === 'imported' && !skill.enabled
              const label = disabled
                ? `${skill.name} (disabled)`
                : pinned
                  ? `${skill.name} (pinned)`
                  : skill.scriptsSkipped
                    ? `${skill.name} (scripts skipped)`
                    : skill.name
              return (
                <div
                  key={skill.id}
                  testId={`skill-${skill.id}`}
                  style={{
                    fontSize: T.type.sm,
                    color: pinned ? T.text : T.secondary,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => {
                    if (disabled) {
                      setSkillEnabled(skill.id, true)
                      bumpLibrary()
                      return
                    }
                    onPatch?.({
                      skillIds: pinned
                        ? profile.skillIds.filter((id) => id !== skill.id)
                        : [...profile.skillIds, skill.id],
                    })
                  }}
                  onScroll={passWheel}
                >
                  {label}
                </div>
              )
            })}
          </div>
        </Section>
      ) : null}
      <Section title="Claims">
        <div testId="inspector-claims" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
          {recent.length === 0 ? (
            <div style={{ fontSize: T.type.sm, color: T.tertiary }}>No claims yet</div>
          ) : (
            recent.map((claim) => (
              <div key={claim.id} style={{ fontSize: T.type.sm, color: T.text, lineHeight: T.line.sm }}>
                {publicClaimText(claim.text) || '…'}
              </div>
            ))
          )}
        </div>
      </Section>
      {sandboxHint ? (
        <Section title="Sandbox">
          <div testId="inspector-sandbox" style={{ fontSize: T.type.sm, color: T.tertiary }}>
            {sandboxHint}
          </div>
        </Section>
      ) : null}
    </div>
  )
}

export function PaneHeader({
  title,
  onClose,
  closeId,
  onScroll,
}: {
  title: string
  onClose: () => void
  closeId: string
  onScroll?: (event: { deltaX?: number; deltaY?: number }) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: title ? 'space-between' : 'flex-end',
        flexShrink: 0,
      }}
    >
      {title ? <div style={{ fontSize: T.type.lg, lineHeight: T.line.lg, color: T.text }}>{title}</div> : null}
      <Chip testId={closeId} tone="ghost" onClick={onClose} onScroll={onScroll}>
        X
      </Chip>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
      <div style={{ fontSize: T.type.xs, color: T.ghost }}>{title}</div>
      {children}
    </div>
  )
}
