import React, { useEffect, useState } from 'react'
import {
  cloudAgentStatusLabel,
  cloudPresenceLabel,
  launchCloudImplement,
  neverGuessOriginFromGithub,
  parseOriginRemote,
  pollCloudAgent,
  probeCloudPresence,
  type CloudAgentSnapshot,
  type CloudPresence,
} from './runtime/cloud-origin'
import { openDashboardUrl } from './runtime/pm-dashboard'
import { Chip, useChrome } from './ui'
import type { Tokens } from './theme'

function parkedTone(presence: CloudPresence, tokens: Tokens): string {
  return presence.launchable ? tokens.text : tokens.secondary
}

/** Settings + Jobs honesty surface for optional cloud-agent / Origin. */
export function CloudOriginPanel({
  bindRepository,
  bindLabel,
  originRemote,
  mode,
}: {
  /** GitHub home for the focused/bound mouth — required to launch. */
  bindRepository?: string
  bindLabel?: string
  /** Explicit Origin remote only — never derived from GitHub. */
  originRemote?: string
  mode: 'settings' | 'jobs'
}) {
  const chrome = useChrome()
  const T = chrome.tokens
  const [presence, setPresence] = useState<CloudPresence | null>(null)
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [note, setNote] = useState('')
  const [agent, setAgent] = useState<CloudAgentSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (process.env.BUN_TEST) {
        const parked: CloudPresence = {
          status: 'parked',
          reason: 'missing_key',
          launchable: false,
          note: `Cloud agent / Origin parked in tests — see docs/cloud-origin.md.`,
        }
        if (!cancelled) setPresence(parked)
        return
      }
      const next = await probeCloudPresence()
      if (!cancelled) setPresence(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const origin = originRemote?.trim() ? parseOriginRemote(originRemote) : null
  // Honesty: GitHub binds never invent Origin slugs.
  if (bindRepository) neverGuessOriginFromGithub(bindRepository)

  const launch = async () => {
    if (!presence?.launchable || !bindRepository?.trim()) return
    const text = prompt.trim() || `Implement the bound work for ${bindLabel || bindRepository}.`
    setBusy(true)
    setNote('')
    const launched = await launchCloudImplement({
      repository: bindRepository,
      prompt: text,
      autoCreatePr: true,
      name: bindLabel ? `Automaton · ${bindLabel}` : undefined,
    })
    setBusy(false)
    if (!launched.ok) {
      setNote(launched.error)
      setAgent(null)
      return
    }
    setAgent(launched.value)
    setNote(`Launched ${launched.value.id}`)
  }

  const refresh = async () => {
    if (!agent?.id) return
    setBusy(true)
    const polled = await pollCloudAgent(agent.id)
    setBusy(false)
    if (!polled.ok) {
      setNote(polled.error)
      return
    }
    setAgent(polled.value)
    setNote(cloudAgentStatusLabel(polled.value))
  }

  const openLink = (url: string) => {
    const opened = openDashboardUrl(url)
    if (!opened.ok) setNote(opened.error || 'Need: could not open URL.')
  }

  return (
    <div
      testId={mode === 'settings' ? 'settings-cloud-origin' : 'jobs-cloud-origin'}
      style={{ ...chrome.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: T.space.md }}>
        <div style={{ fontSize: T.type.sm, color: T.text }}>Cloud agent / Origin</div>
        <div
          testId={mode === 'settings' ? 'settings-cloud-status' : 'jobs-cloud-status'}
          style={{ fontSize: T.type.sm, color: parkedTone(presence ?? { status: 'parked', launchable: false, note: '' }, T) }}
        >
          {presence ? cloudPresenceLabel(presence) : 'checking…'}
        </div>
      </div>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Optional transport. Durable coding still books local Puppetmaster jobs. Mouths stay Send. No private
        Cursor packages — public Cloud Agents API only. See docs/cloud-origin.md.
      </div>
      {presence && !presence.launchable ? (
        <div
          testId={mode === 'settings' ? 'settings-cloud-parked' : 'jobs-cloud-parked'}
          style={{ fontSize: T.type.sm, color: T.secondary }}
        >
          {presence.note}
        </div>
      ) : null}
      {origin ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm, alignItems: 'center' }}>
          <div style={{ fontSize: T.type.xs, color: T.secondary, flexGrow: 1 }}>
            Origin forge · {origin.owner}/{origin.repo}
          </div>
          <Chip
            testId={mode === 'settings' ? 'settings-origin-browse' : 'jobs-origin-browse'}
            tone="ghost"
            onClick={() => openLink(origin.browseUrl)}
          >
            Browse Origin
          </Chip>
        </div>
      ) : (
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
          Origin links appear only from an explicit origin.cursor.com remote — never guessed from GitHub.
        </div>
      )}
      {presence?.launchable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
          <div style={{ fontSize: T.type.xs, color: T.secondary }}>
            {bindRepository
              ? `Bind: ${bindLabel || bindRepository}`
              : 'Point a mouth at a github.com home to launch cloud implement for that bind.'}
          </div>
          {bindRepository ? (
            <>
              <textarea
                testId={mode === 'settings' ? 'settings-cloud-prompt' : 'jobs-cloud-prompt'}
                value={prompt}
                placeholder="Cloud implement prompt"
                minRows={2}
                maxRows={4}
                theme={chrome.fieldTheme}
                style={chrome.field}
                onChange={(event) => setPrompt(event.value ?? '')}
              />
              <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
                <Chip
                  testId={mode === 'settings' ? 'settings-cloud-launch' : 'jobs-cloud-launch'}
                  tone="action"
                  onClick={() => {
                    if (!busy) void launch()
                  }}
                >
                  {busy ? 'Working…' : 'Launch cloud implement'}
                </Chip>
                {agent ? (
                  <Chip
                    testId={mode === 'settings' ? 'settings-cloud-refresh' : 'jobs-cloud-refresh'}
                    tone="ghost"
                    onClick={() => {
                      if (!busy) void refresh()
                    }}
                  >
                    Refresh status
                  </Chip>
                ) : null}
              </div>
            </>
          ) : (
            <div
              testId={mode === 'settings' ? 'settings-cloud-need-bind' : 'jobs-cloud-need-bind'}
              style={{ fontSize: T.type.sm, color: T.secondary }}
            >
              No GitHub bind on the focused mouth — cloud launch stays hidden (not a no-op button).
            </div>
          )}
        </div>
      ) : null}
      {agent ? (
        <div
          testId={mode === 'settings' ? 'settings-cloud-agent' : 'jobs-cloud-agent'}
          style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}
        >
          <div style={{ fontSize: T.type.sm, color: T.text }}>
            {agent.name} · {cloudAgentStatusLabel(agent)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
            {agent.agentUrl ? (
              <Chip
                testId={mode === 'settings' ? 'settings-cloud-open-agent' : 'jobs-cloud-open-agent'}
                tone="ghost"
                onClick={() => openLink(agent.agentUrl!)}
              >
                Open agent
              </Chip>
            ) : null}
            {agent.prUrl ? (
              <Chip
                testId={mode === 'settings' ? 'settings-cloud-open-pr' : 'jobs-cloud-open-pr'}
                tone="action"
                onClick={() => openLink(agent.prUrl!)}
              >
                Open PR
              </Chip>
            ) : null}
          </div>
        </div>
      ) : null}
      {note ? (
        <div
          testId={mode === 'settings' ? 'settings-cloud-note' : 'jobs-cloud-note'}
          style={{ fontSize: T.type.xs, color: T.secondary }}
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}
