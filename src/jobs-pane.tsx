import React from 'react'
import type { Agent, JobHandle } from './domain'
import { jobKindLabel } from './domain'
import { CloudOriginPanel } from './cloud-origin-panel'
import { foldJobTraces, stepRow } from './chrome/step-row'
import { groupBoxStyle } from './chrome/surface'
import { isDashboardJobId } from './runtime/pm-dashboard'
import { PaneHeader, Section } from './inspector'
import { Chip } from './ui'
import { useTokens } from './theme'

function jobIndexLabel(job: JobHandle, agents: Agent[]): string {
  const owner = agents.find((agent) => agent.id === job.ownerAgentId)
  return [owner?.name ?? 'Agent', jobKindLabel(job.kind), job.status, job.lastNote || job.goal]
    .filter(Boolean)
    .join(' · ')
}

/** Skinny index of flying jobs — not chat, not a webview. */
export function JobsStrip({
  jobs,
  agents,
  onOpenPane,
  onSelect,
}: {
  jobs: JobHandle[]
  agents: Agent[]
  onOpenPane: () => void
  onSelect: (job: JobHandle) => void
}) {
  const T = useTokens()
  if (jobs.length === 0) return null
  const folded = foldJobTraces(jobs)
  return (
    <div
      testId="jobs-strip"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.xs,
        paddingLeft: T.space.lg,
        paddingRight: T.space.lg,
        minHeight: T.jobStrip.height,
        paddingTop: T.space.sm,
        paddingBottom: T.space.sm,
        borderTopWidth: T.stroke.hairline,
        borderTopColor: T.border,
        backgroundColor: T.canvas,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
        <div style={{ fontSize: T.type.xs, color: T.secondary, flexGrow: 1 }}>Jobs</div>
        <Chip testId="jobs-strip-open" tone="ghost" onClick={onOpenPane}>
          Open
        </Chip>
      </div>
      {folded.length > 0 ? (
        <div testId="jobs-strip-fold" style={{ fontSize: T.type.xs, color: T.ghost }}>
          {folded.map((row) => (row.count > 1 ? `${row.verb} ×${row.count}` : row.verb)).join(' · ')}
        </div>
      ) : null}
      {jobs.map((job) => (
        <div
          key={job.id}
          testId={`jobs-strip-row-${job.id}`}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: T.space.sm,
            cursor: 'pointer',
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
          onClick={() => onSelect(job)}
        >
          <div
            style={{
              fontSize: T.type.sm,
              color: T.secondary,
              flexGrow: 1,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {jobIndexLabel(job, agents)}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Slide rail index + Expand/Pop-out. Board lives in host Chrome. */
export function JobsPane({
  jobs,
  agents,
  note,
  bindRepository,
  bindLabel,
  originRemote,
  onClose,
  onOpenBoard,
  onOpenJob,
}: {
  jobs: JobHandle[]
  agents: Agent[]
  note?: string
  /** GitHub home for the focused mouth — cloud launch only when present + API ready. */
  bindRepository?: string
  bindLabel?: string
  /** Explicit Origin remote only — never guessed from GitHub. */
  originRemote?: string
  onClose: () => void
  onOpenBoard: () => void
  onOpenJob: (job: JobHandle) => void
}) {
  const T = useTokens()
  return (
    <div
      testId="jobs-pane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.md,
        height: '100%',
        padding: T.space.lg,
        backgroundColor: T.canvas,
        borderLeftWidth: T.stroke.hairline,
        borderLeftColor: T.border,
        minHeight: 0,
      }}
    >
      <PaneHeader title="Jobs" onClose={onClose} closeId="jobs-close" />
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Puppetmaster board. Expand opens host Chrome — not an in-app webview.
      </div>
      {note ? (
        <div testId="jobs-note" style={{ fontSize: T.type.sm, color: T.danger }}>
          {note}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
        <Chip testId="jobs-open-board" tone="action" onClick={onOpenBoard}>
          Expand board
        </Chip>
      </div>
      <Section title="Cloud / Origin">
        <CloudOriginPanel
          mode="jobs"
          bindRepository={bindRepository}
          bindLabel={bindLabel}
          originRemote={originRemote}
        />
      </Section>
      <Section title="Flying">
        {jobs.length === 0 ? (
          <div testId="jobs-empty" style={{ fontSize: T.type.sm, color: T.tertiary }}>
            No running jobs.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
            {jobs.map((job) => {
              const durable = Boolean(job.pmJobId && isDashboardJobId(job.pmJobId))
              const steps = foldJobTraces([job])
              return (
                <div
                  key={job.id}
                  testId={`jobs-row-${job.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: T.space.xs,
                    ...groupBoxStyle(T, 'group'),
                    padding: T.space.sm,
                  }}
                >
                  <div style={{ fontSize: T.type.sm, color: T.text }}>{jobIndexLabel(job, agents)}</div>
                  {steps.map((row, index) => (
                    <div
                      key={`${row.verb}-${index}`}
                      testId={`jobs-step-${job.id}-${index}`}
                      style={{ fontSize: T.type.xs, color: T.tertiary }}
                    >
                      {stepRow(row.verb, row.detail)}
                    </div>
                  ))}
                  <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs }}>
                    <Chip
                      testId={`jobs-pop-${job.id}`}
                      tone={durable ? 'action' : 'ghost'}
                      onClick={() => onOpenJob(job)}
                    >
                      {durable ? 'Pop out' : 'Open board'}
                    </Chip>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
