import React, { useEffect, useState } from 'react'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, AgentKit, JobHandle } from './domain'
import type { LedgerMetrics, StaffStore } from './runtime/store'
import type { AgentProfile } from './runtime/profile'
import { captureScreen } from './runtime/chrome'
import { desktopPreview } from './runtime/desktop'
import { automatonHome } from './runtime/keys'
import { listSkills } from './runtime/skills'
import type { Claim } from './runtime/working-set'
import { CHAT_THEME, T } from './tokens'

const SECRET = /sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|OPENROUTER_API_KEY\s*=\s*\S+/gi
const SPOKEN_JOB = /\bjob_[A-Za-z0-9]+\b/g
const KITS: AgentKit[] = ['coordinator', 'code', 'lookup', 'blank']

export function publicClaimText(text: string): string {
  return text.replace(SECRET, '[redacted]').replace(SPOKEN_JOB, '').replace(/\s+/g, ' ').trim()
}

export function lastMouthClaims(claims: Claim[], ownerAgentId: string, limit = 3): Claim[] {
  return claims.filter((claim) => claim.ownerAgentId === ownerAgentId).slice(-limit).reverse()
}

export function lastMouthJob(jobs: JobHandle[], ownerAgentId: string): JobHandle | undefined {
  return [...jobs].reverse().find((job) => job.ownerAgentId === ownerAgentId)
}

export function formatKnown(
  total: number | null,
  known: number,
  unknown: number,
): string {
  if (total == null) {
    if (unknown > 0 && known > 0) return `unknown (${known} known)`
    return 'unknown'
  }
  return String(total)
}

export function ledgerRows(metrics: LedgerMetrics): { label: string; value: string }[] {
  return [
    { label: 'Turns', value: String(metrics.turns) },
    { label: 'Hits', value: String(metrics.hits) },
    { label: 'Misses', value: String(metrics.misses) },
    { label: 'Avoided', value: String(metrics.inferenceAvoided) },
    { label: 'Calls', value: String(metrics.inferenceCalls) },
    {
      label: 'Prompt tokens',
      value: formatKnown(metrics.promptTokens, metrics.promptTokensKnown, metrics.promptTokensUnknown),
    },
    {
      label: 'Completion tokens',
      value: formatKnown(
        metrics.completionTokens,
        metrics.completionTokensKnown,
        metrics.completionTokensUnknown,
      ),
    },
    { label: 'Cost', value: formatKnown(metrics.costUsd, metrics.costKnown, metrics.costUnknown) },
  ]
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

export function Inspector({
  agent,
  profile,
  claims,
  lastJob,
  metrics,
  sandboxHint,
  onClose,
  onPatch,
}: {
  agent: Agent
  profile?: AgentProfile | null
  claims: Claim[]
  lastJob?: JobHandle
  metrics: LedgerMetrics
  sandboxHint: string | null
  onClose: () => void
  onPatch?: (patch: Partial<AgentProfile>) => void
}) {
  const recent = lastMouthClaims(claims, agent.id)
  const kit = profile?.kit ?? 'blank'
  const markLabel = profile ? `${profile.avatarShape} · ${profile.avatarColor}` : ''
  const preview = desktopPreview(agent.id)
  const [screen, setScreen] = useState<string | null>(preview.screen)
  const recapture = async () => {
    const path = await captureScreen(agent.id)
    setScreen(path)
  }
  useEffect(() => {
    void recapture()
  }, [agent.id])
  const library = listSkills()
  return (
    <div
      testId="inspector"
      style={{
        width: T.layout.sidebarWidth,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: T.sidebar,
        borderLeftWidth: T.stroke.hairline,
        borderLeftColor: T.border,
        paddingLeft: T.space.lg,
        paddingRight: T.space.lg,
        paddingTop: T.space.md,
        paddingBottom: T.space.lg,
        gap: T.space.md,
        overflowY: 'scroll',
      }}
    >
      <PaneHeader title="Inspector" onClose={onClose} closeId="inspector-close" />
      <div testId="inspector-mouth" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xxs }}>
        <div style={{ fontSize: T.type.md, color: T.text }}>{agent.name}</div>
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>{agent.title}</div>
        <div style={{ fontSize: T.type.sm, color: T.tertiary, lineHeight: T.line.sm }}>{agent.description}</div>
      </div>
      <Section title="Desktop">
        <div testId="inspector-desktop" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
          {screen ? (
            <img
              src={screen}
              objectFit="contain"
              alt=""
              style={{ width: '100%', height: T.attach.thumb, cursor: 'pointer' }}
              onClick={() => {
                void recapture()
              }}
            />
          ) : (
            <div style={{ fontSize: T.type.sm, color: T.tertiary }}>No screen yet</div>
          )}
          <div
            testId="desktop-refresh"
            style={{
              alignSelf: 'flex-start',
              paddingLeft: T.space.sm,
              paddingRight: T.space.sm,
              paddingTop: T.space.xxs,
              paddingBottom: T.space.xxs,
              borderRadius: T.radius.sm,
              backgroundColor: T.overlay,
              fontSize: T.type.xs,
              color: T.text,
              cursor: 'pointer',
              userSelect: 'none',
            }}
            onClick={() => {
              void recapture()
            }}
          >
            Refresh
          </div>
          <div style={{ fontSize: T.type.xs, color: T.ghost }}>{preview.dir}</div>
        </div>
      </Section>
      {profile ? (
        <Section title="Mark">
          <div testId="inspector-mark" style={{ fontSize: T.type.sm, color: T.text }}>
            {markLabel}
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
                    backgroundColor: selected ? T.inverse : T.overlay,
                    color: selected ? T.onInverse : T.text,
                    fontSize: T.type.xs,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => onPatch?.({ kit: item })}
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
            placeholder="Standing instructions for this mouth"
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
              borderRadius: T.radius.sm,
              paddingLeft: T.space.sm,
              paddingRight: T.space.sm,
              paddingTop: T.space.xs,
              paddingBottom: T.space.xs,
            }}
            onChange={(event) => onPatch?.({ rules: event.value ?? '' })}
          />
        </Section>
      ) : null}
      {profile ? (
        <Section title="Skills">
          <div testId="inspector-skills" style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
            {library.length === 0 && profile.skillIds.length === 0 ? (
              <div style={{ fontSize: T.type.sm, color: T.tertiary }}>No skills pinned</div>
            ) : null}
            {library.map((skill) => {
              const pinned = profile.skillIds.includes(skill.id)
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
                  onClick={() =>
                    onPatch?.({
                      skillIds: pinned
                        ? profile.skillIds.filter((id) => id !== skill.id)
                        : [...profile.skillIds, skill.id],
                    })
                  }
                >
                  {pinned ? `${skill.name} (pinned)` : skill.name}
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
      <Section title="Last job">
        <div testId="inspector-job" style={{ fontSize: T.type.sm, color: T.text }}>
          {lastJob ? `${lastJob.kind} · ${lastJob.status}` : 'No job handle'}
        </div>
      </Section>
      <Section title="Usage">
        <LedgerList metrics={metrics} testId="inspector-ledger" />
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
}: {
  title: string
  onClose: () => void
  closeId: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>{title}</div>
      <div
        testId={closeId}
        style={{
          paddingLeft: T.space.sm,
          paddingRight: T.space.sm,
          paddingTop: T.space.xs,
          paddingBottom: T.space.xs,
          borderRadius: T.radius.sm,
          backgroundColor: T.overlay,
          fontSize: T.type.sm,
          color: T.text,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onClose}
      >
        X
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{title}</div>
      {children}
    </div>
  )
}
