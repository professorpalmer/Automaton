import React, { useEffect, useMemo, useState } from 'react'
import { motion } from '@gpuix/react'
import {
  DEFAULT_AGENTS,
  emptyThreads,
  isMouthBusy,
  nextId,
  type Agent,
  type FeedItem,
  type JobHandle,
} from './domain'
import { ingestPath, pickLocalFiles } from './runtime/attachments'
import { abandonJob, ensureDispatched } from './runtime/jobs'
import { createAgent, destroyAgent, hydrateSession, liveAgentFromProfile } from './runtime/factory'
import { adoptMarionetteOpenRouterKey } from './runtime/keys'
import { ensureMouth } from './runtime/mouth'
import { readProfile, writeProfile, type AgentProfile } from './runtime/profile'
import { openStaffStore, type StaffStore } from './runtime/store'
import { claimTaskKey } from './runtime/working-set'
import {
  Inspector,
  inspectorChord,
  isStoreAnswer,
  kernelSandboxHint,
  lastMouthJob,
} from './inspector'
import {
  addLiveAgent,
  askDelete,
  attachPmJob,
  completeJob,
  completeMouth,
  confirmFanout,
  dismissDelete,
  dismissFanout,
  dropLiveAgent,
  dropPendingPath,
  failJob,
  failMouth,
  patchLiveAgent,
  queuePaths,
  runningJobs,
  send,
  setActive,
  setDraft,
  stopJob,
  type Session,
} from './session'
import { SisterBlob } from './blob'
import { Settings } from './settings'
import { CHAT_THEME, T } from './tokens'

type Pane = 'none' | 'inspector' | 'settings'

const TRAFFIC =
  typeof process !== 'undefined' && process.platform === 'darwin'
    ? T.layout.trafficLightClearance
    : T.space.sm

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

function emptySeed(): Session {
  return {
    agents: DEFAULT_AGENTS,
    activeAgentId: 'staff',
    threads: emptyThreads(DEFAULT_AGENTS),
    jobs: [],
    pendingFanout: null,
    pendingDelete: null,
  }
}

export function App({ store: providedStore }: { store?: StaffStore } = {}) {
  const store = useMemo(() => {
    if (providedStore) return providedStore
    adoptMarionetteOpenRouterKey()
    return openStaffStore()
  }, [providedStore])
  const [session, setSession] = useState<Session>(() => hydrateSession(store.load() ?? emptySeed()))
  const [pane, setPane] = useState<Pane>('none')
  const active = session.agents.find((agent) => agent.id === session.activeAgentId)
  const thread = session.threads[session.activeAgentId]
  const jobs = runningJobs(session)
  const metrics = store.metrics()
  const claims = store.listClaims()
  const lastJob = active ? lastMouthJob(session.jobs, active.id) : undefined
  const profile = active ? readProfile(active.id) : null
  const sandboxHint = active ? kernelSandboxHint(active.id, profile?.kit) : null
  const mouthEpoch = Object.values(session.threads)
    .map((row) => `${row.agentId}:${row.mouth}`)
    .join('|')

  const toggleInspector = () => {
    setPane((current) => (current === 'inspector' ? 'none' : 'inspector'))
  }

  useEffect(() => {
    store.save(session)
  }, [store, session])

  useEffect(() => {
    void ensureMouth(session, store, {
      onComplete: (agentId, spoken) => {
        setSession((current) => completeMouth(current, agentId, spoken))
      },
      onFail: (agentId, spoken) => {
        setSession((current) => failMouth(current, agentId, spoken))
      },
    })
  }, [store, mouthEpoch])

  useEffect(() => {
    for (const job of runningJobs(session)) {
      let pmIdentity = job.pmJobId
      void ensureDispatched(
        job,
        {
          onAttached: (pmJobId) => {
            pmIdentity = pmJobId
            setSession((current) => attachPmJob(current, job.id, pmJobId))
          },
          onComplete: (spoken) => {
            store.remember({
              ownerAgentId: job.ownerAgentId,
              text: spoken,
              source: 'job',
              jobId: pmIdentity,
              taskKey: claimTaskKey({
                ownerAgentId: job.ownerAgentId,
                kind: job.kind,
                goal: job.goal,
              }),
              artifactKind: job.kind,
              freshness: 'fresh',
            })
            setSession((current) => completeJob(current, job.id, spoken))
          },
          onFail: (spoken) => {
            setSession((current) => failJob(current, job.id, spoken))
          },
        },
        session.jobs,
      )
    }
  }, [store, session.jobs.map((job) => `${job.id}:${job.status}`).join('|')])

  const onSend = () => {
    if (!thread || !active) return
    setSession((current) => {
      const row = current.threads[current.activeAgentId]
      if (!row) return current
      const ids: string[] = []
      for (const path of row.pendingPaths ?? []) {
        try {
          const attachment = ingestPath(current.activeAgentId, path, nextId('att'))
          store.recordAttachment(attachment)
          ids.push(attachment.id)
        } catch {
          /* missing path stays off the bubble */
        }
      }
      const next = send(current, row.draft, ids)
      const last = [...(next.threads[next.activeAgentId]?.items ?? [])]
        .reverse()
        .find((item) => item.kind === 'msg' && item.from === 'user')
      if (last?.kind === 'msg') store.bindAttachments(ids, last.id)
      return next
    })
  }

  const onAttach = () => {
    const paths = pickLocalFiles()
    if (paths.length === 0) return
    setSession((current) => queuePaths(current, paths))
  }

  const onCreateAgent = () => {
    const created = createAgent()
    setSession((current) => addLiveAgent(current, created.agent, true))
    setPane('inspector')
  }

  const onPatchProfile = (patch: Partial<AgentProfile>) => {
    if (!active) return
    const current = readProfile(active.id)
    if (!current) return
    const next = {
      ...current,
      ...patch,
      namedBy: patch.name && patch.name !== current.name ? ('user' as const) : current.namedBy,
    }
    writeProfile(next)
    setSession((row) => patchLiveAgent(row, liveAgentFromProfile(next)))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: T.canvas,
        color: T.text,
      }}
      onKeyDown={(event) => {
        if (inspectorChord(event)) toggleInspector()
      }}
    >
      <Rail
        session={session}
        onSelect={(id) => {
          setSession((current) => setActive(current, id))
          setPane((current) => (current === 'settings' ? 'none' : current))
        }}
        onCreate={onCreateAgent}
        onDeleteAsk={(id) => setSession((current) => askDelete(current, id))}
        onSettings={() => {
          setPane((current) => (current === 'settings' ? 'none' : 'settings'))
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minWidth: 0,
          backgroundColor: T.canvas,
        }}
      >
        <Titlebar
          name={active?.name ?? 'Automaton'}
          title={active?.title ?? ''}
          onInspect={toggleInspector}
        />
        {pane === 'settings' ? (
          <Settings metrics={metrics} onClose={() => setPane('none')} />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexGrow: 1,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <Feed
                items={thread?.items ?? []}
                agents={session.agents}
                storeAnswer={(userItemId) => isStoreAnswer(store, userItemId)}
                attachmentsFor={(ids) =>
                  ids.flatMap((id) => store.listAttachments().filter((row) => row.id === id))
                }
              />
              {pane === 'inspector' && active ? (
                <Inspector
                  agent={active}
                  profile={profile}
                  claims={claims}
                  lastJob={lastJob}
                  metrics={metrics}
                  sandboxHint={sandboxHint}
                  onClose={() => setPane('none')}
                  onPatch={onPatchProfile}
                />
              ) : null}
            </div>
            {jobs.length > 0 ? (
              <JobStrip
                jobs={jobs}
                agents={session.agents}
                onStop={(id) => {
                  abandonJob(id)
                  setSession((current) => stopJob(current, id))
                }}
              />
            ) : null}
            {session.pendingFanout ? (
              <ConfirmCard
                testId="fanout-confirm"
                prompt={`Message ${session.pendingFanout.targets
                  .map((id) => session.agents.find((agent) => agent.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')}?`}
                confirmId="fanout-confirm-yes"
                dismissId="fanout-confirm-no"
                confirmLabel="Confirm"
                onConfirm={() => setSession((current) => confirmFanout(current))}
                onDismiss={() => setSession((current) => dismissFanout(current))}
              />
            ) : null}
            {session.pendingDelete ? (
              <ConfirmCard
                testId="delete-confirm"
                prompt={`Delete ${session.agents.find((agent) => agent.id === session.pendingDelete)?.name ?? 'this agent'}?`}
                confirmId="delete-confirm-yes"
                dismissId="delete-confirm-no"
                confirmLabel="Delete"
                danger
                onConfirm={() => {
                  const id = session.pendingDelete
                  if (!id) return
                  destroyAgent(id)
                  setSession((current) => dropLiveAgent(current, id))
                }}
                onDismiss={() => setSession((current) => dismissDelete(current))}
              />
            ) : null}
            <Composer
              value={thread?.draft ?? ''}
              pendingPaths={thread?.pendingPaths ?? []}
              locked={!thread || isMouthBusy(thread.mouth)}
              onChange={(value) => setSession((current) => setDraft(current, value))}
              onAttach={onAttach}
              onDropPending={(path) => setSession((current) => dropPendingPath(current, path))}
              onSend={onSend}
            />
          </>
        )}
      </div>
    </div>
  )
}
function Rail({
  session,
  onSelect,
  onCreate,
  onDeleteAsk,
  onSettings,
}: {
  session: Session
  onSelect: (id: string) => void
  onCreate: () => void
  onDeleteAsk: (id: string) => void
  onSettings: () => void
}) {
  const agents = session.agents.filter((agent) => !agent.hidden)
  return (
    <motion.div
      initial={false}
      animate={{ width: T.layout.sidebarWidth }}
      transition={{ duration: T.motion.sidebarMs / 1000, ease: 'easeOut' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: T.layout.sidebarWidth,
        height: '100%',
        overflow: 'hidden',
        backgroundColor: T.sidebar,
        borderRightWidth: T.stroke.hairline,
        borderRightColor: T.sidebarBorder,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          height: T.layout.titlebarHeight,
          paddingLeft: TRAFFIC,
          paddingRight: T.space.md,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>Agents</div>
      </div>
      {agents.map((agent, index) => {
        const row = session.threads[agent.id]
        const selected = agent.id === session.activeAgentId
        return (
          <div
            key={agent.id}
            testId={`agent-${agent.id}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: T.space.sm,
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.sm,
              paddingBottom: T.space.sm,
              marginLeft: T.space.sm,
              marginRight: T.space.sm,
              marginBottom: T.space.xxs,
              borderRadius: T.radius.sm,
              ...HIT,
              backgroundColor: selected ? T.raised : T.sidebar,
              hover: { backgroundColor: T.raised },
              active: { backgroundColor: T.raised },
            }}
            onClick={() => onSelect(agent.id)}
            onMouseDown={(event) => {
              if (event.isRightClick || event.button === 2) {
                onSelect(agent.id)
                onDeleteAsk(agent.id)
              }
            }}
          >
            <SisterBlob
              agent={agent}
              selected={selected}
              unread={row?.unread ?? 0}
              mouthBusy={isMouthBusy(row?.mouth ?? 'idle')}
              index={index}
            />
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: T.type.md, color: T.text }}>{agent.name}</div>
              <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{agent.title}</div>
            </div>
            {row?.unread ? (
              <motion.div
                initial={{ opacity: 0, width: 0, height: T.size.badge }}
                animate={{ opacity: 1, width: T.size.badge, height: T.size.badge }}
                transition={{ duration: T.motion.unread, ease: 'easeOut' }}
                style={{
                  minWidth: T.size.badge,
                  paddingLeft: T.space.inset,
                  paddingRight: T.space.inset,
                  borderRadius: T.radius.badge,
                  backgroundColor: T.inverse,
                  color: T.onInverse,
                  fontSize: T.type.xs,
                }}
              >
                {String(row.unread)}
              </motion.div>
            ) : null}
          </div>
        )
      })}
      <div style={{ flexGrow: 1 }} />
      <div
        testId="new-agent"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: T.space.md,
          paddingRight: T.space.md,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          marginLeft: T.space.sm,
          marginRight: T.space.sm,
          marginBottom: T.space.xxs,
          borderRadius: T.radius.sm,
          ...HIT,
          backgroundColor: T.sidebar,
          hover: { backgroundColor: T.raised },
        }}
        onClick={onCreate}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>New agent</div>
      </div>
      <div
        testId="settings-open"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: T.space.md,
          paddingRight: T.space.md,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          marginLeft: T.space.sm,
          marginRight: T.space.sm,
          marginBottom: T.space.md,
          borderRadius: T.radius.sm,
          ...HIT,
          backgroundColor: T.sidebar,
          hover: { backgroundColor: T.raised },
        }}
        onClick={onSettings}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>Settings</div>
      </div>
    </motion.div>
  )
}
function Titlebar({
  name,
  title,
  onInspect,
}: {
  name: string
  title: string
  onInspect: () => void
}) {
  return (
    <div
      testId="titlebar"
      style={{
        height: T.layout.titlebarHeight,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: T.space.lg,
        paddingRight: T.space.lg,
        borderBottomWidth: T.stroke.hairline,
        borderBottomColor: T.border,
        backgroundColor: T.canvas,
        ...HIT,
        flexShrink: 0,
      }}
      onClick={onInspect}
    >
      <div testId="titlebar-name" style={{ fontSize: T.type.md, color: T.text }}>
        {name}
      </div>
      <div style={{ fontSize: T.type.sm, color: T.tertiary, marginLeft: T.space.sm }}>{title}</div>
    </div>
  )
}

function precedingUserId(items: FeedItem[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const prior = items[cursor]
    if (prior?.kind === 'msg' && prior.from === 'user') return prior.id
  }
  return null
}

const feedScrollStyle = {
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'scroll',
  overflowAnchor: 'auto',
  scrollPaddingBottom: T.space.lg,
  paddingLeft: T.space.xl,
  paddingRight: T.space.xl,
  paddingTop: T.space.lg,
  paddingBottom: T.space.lg,
  gap: T.space.md,
}

export function Feed({
  items,
  agents,
  storeAnswer,
  attachmentsFor,
}: {
  items: FeedItem[]
  agents: Agent[]
  storeAnswer: (userItemId: string) => boolean
  attachmentsFor?: (ids: string[]) => { id: string; path: string; kind: 'image' | 'file' }[]
}) {
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id
  return (
    <div testId="feed" style={feedScrollStyle}>
      {items.length === 0 ? (
        <div style={{ color: T.tertiary, fontSize: T.type.md }}>
          Send stays Send. Jobs are handles, not chat.
        </div>
      ) : null}
      {items.map((item, index) => {
        if (item.kind === 'agent_note') {
          return (
            <div key={item.id} style={{ fontSize: T.type.sm, color: T.tertiary }}>
              {nameOf(item.fromId)} → {nameOf(item.toId)}: {item.text}
            </div>
          )
        }
        const mine = item.from === 'user'
        const userItemId = mine ? null : precedingUserId(items, index)
        const fromStore = userItemId ? storeAnswer(userItemId) : false
        const files = item.attachmentIds?.length ? attachmentsFor?.(item.attachmentIds) ?? [] : []
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: mine ? 'flex-end' : 'flex-start',
            }}
          >
            {files.map((file) =>
              file.kind === 'image' ? (
                <div
                  key={file.id}
                  testId={`thumb-${file.id}`}
                  style={{ marginBottom: T.space.xs }}
                >
                  <img
                    src={file.path}
                    objectFit="contain"
                    alt=""
                    style={{
                      width: T.attach.thumb,
                      height: T.attach.thumb,
                    }}
                  />
                </div>
              ) : (
                <div key={file.id} testId={`file-${file.id}`} style={{ marginBottom: T.space.xs }}>
                  <code code={file.path} language="text" theme={CHAT_THEME} />
                </div>
              ),
            )}
            {item.text ? (
            <div
              style={{
                maxWidth: T.layout.contentMax,
                backgroundColor: mine ? T.raised : T.clear,
                borderRadius: T.radius.md,
                paddingTop: T.space.sm,
                paddingBottom: T.space.sm,
                paddingLeft: T.space.md,
                paddingRight: T.space.md,
                fontSize: T.type.md,
                lineHeight: T.line.md,
                minHeight: T.line.md,
                color: T.text,
              }}
            >
              {mine ? item.text : <markdown source={item.text} theme={CHAT_THEME} />}
            </div>
            ) : null}
            {fromStore ? (
              <div
                testId="query-hit"
                style={{
                  fontSize: T.type.xs,
                  color: T.tertiary,
                  marginTop: T.space.xxs,
                  paddingLeft: T.space.md,
                }}
              >
                answered from store
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function JobStrip({
  jobs,
  agents,
  onStop,
}: {
  jobs: JobHandle[]
  agents: Agent[]
  onStop: (id: string) => void
}) {
  return (
    <div
      testId="job-strip"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.xs,
        paddingLeft: T.space.lg,
        paddingRight: T.space.lg,
        paddingTop: T.space.sm,
        paddingBottom: T.space.sm,
        borderTopWidth: T.stroke.hairline,
        borderTopColor: T.border,
        flexShrink: 0,
      }}
    >
      {jobs.map((job) => {
        const owner = agents.find((agent) => agent.id === job.ownerAgentId)
        const label = `${owner?.name ?? 'Agent'} · ${job.kind} · ${job.goal}`
        return (
          <div
            key={job.id}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: T.space.sm,
            }}
          >
            <div style={{ fontSize: T.type.sm, color: T.secondary, flexGrow: 1 }}>{label}</div>
            <div
              testId={`stop-${job.id}`}
              style={{
                paddingLeft: T.space.sm,
                paddingRight: T.space.sm,
                paddingTop: T.space.xs,
                paddingBottom: T.space.xs,
                borderRadius: T.radius.sm,
                backgroundColor: T.raised,
                fontSize: T.type.xs,
                color: T.text,
                ...HIT,
              }}
              onClick={() => onStop(job.id)}
            >
              Stop
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ConfirmCard({
  testId,
  prompt,
  confirmId,
  dismissId,
  confirmLabel,
  danger,
  onConfirm,
  onDismiss,
}: {
  testId: string
  prompt: string
  confirmId: string
  dismissId: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <div
      testId={testId}
      style={{
        marginLeft: T.space.xl,
        marginRight: T.space.xl,
        marginBottom: T.space.sm,
        padding: T.space.md,
        borderRadius: T.radius.md,
        backgroundColor: T.raised,
        borderWidth: T.stroke.hairline,
        borderColor: T.border,
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.sm,
      }}
    >
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>{prompt}</div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
        <div
          testId={confirmId}
          style={{
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.xs,
            paddingBottom: T.space.xs,
            borderRadius: T.radius.sm,
            backgroundColor: danger ? T.danger : T.inverse,
            color: danger ? T.inverse : T.onInverse,
            fontSize: T.type.sm,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={onConfirm}
        >
          {confirmLabel}
        </div>
        <div
          testId={dismissId}
          style={{
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.xs,
            paddingBottom: T.space.xs,
            borderRadius: T.radius.sm,
            backgroundColor: T.raised,
            color: T.text,
            fontSize: T.type.sm,
            ...HIT,
          }}
          onClick={onDismiss}
        >
          Dismiss
        </div>
      </div>
    </div>
  )
}

function Composer({
  value,
  pendingPaths,
  locked,
  onChange,
  onAttach,
  onDropPending,
  onSend,
}: {
  value: string
  pendingPaths: string[]
  locked: boolean
  onChange: (value: string) => void
  onAttach: () => void
  onDropPending: (path: string) => void
  onSend: () => void
}) {
  const ready = (value.trim().length > 0 || pendingPaths.length > 0) && !locked
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        paddingLeft: T.space.xl,
        paddingRight: T.space.xl,
        paddingBottom: T.space.lg,
        paddingTop: T.space.sm,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: T.layout.contentMax,
          backgroundColor: T.composer,
          borderRadius: T.radius.lg,
          borderWidth: T.stroke.hairline,
          borderColor: T.border,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
        }}
      >
        {pendingPaths.length > 0 ? (
          <div
            testId="pending-files"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: T.space.xxs,
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingBottom: T.space.xs,
            }}
          >
            {pendingPaths.map((path, index) => (
              <div
                key={path}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: T.space.sm,
                }}
              >
                <div style={{ fontSize: T.type.xs, color: T.tertiary, minWidth: 0, flexGrow: 1 }}>
                  {path.split('/').pop()}
                </div>
                <div
                  testId={`pending-drop-${index}`}
                  style={{
                    paddingLeft: T.space.sm,
                    paddingRight: T.space.sm,
                    paddingTop: T.space.control,
                    paddingBottom: T.space.control,
                    borderRadius: T.radius.sm,
                    backgroundColor: T.raised,
                    color: T.secondary,
                    fontSize: T.type.xs,
                    pointerEvents: 'auto',
                    cursor: locked ? 'default' : 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => {
                    if (!locked) onDropPending(path)
                  }}
                >
                  Remove
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          testId="composer"
          value={value}
          placeholder="Message this agent"
          minRows={1}
          maxRows={4}
          autoFocus
          theme={CHAT_THEME}
          style={{
            width: '100%',
            minWidth: 0,
            fontSize: T.type.md,
            lineHeight: T.line.md,
            color: T.text,
            backgroundColor: T.composer,
            borderWidth: T.stroke.none,
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
          }}
          onChange={(event) => onChange(event.value ?? '')}
          onSubmit={() => {
            if (ready) onSend()
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.sm,
          }}
        >
          <div
            testId="attach"
            style={{
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.control,
              paddingBottom: T.space.control,
              borderRadius: T.radius.sm,
              backgroundColor: T.raised,
              color: T.text,
              fontSize: T.type.sm,
              ...HIT,
            }}
            onClick={onAttach}
          >
            +
          </div>
          <div
            testId="send"
            style={{
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.control,
              paddingBottom: T.space.control,
              borderRadius: T.radius.sm,
              backgroundColor: ready ? T.inverse : T.raised,
              color: ready ? T.onInverse : T.tertiary,
              fontSize: T.type.sm,
              ...HIT,
              cursor: ready ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (ready) onSend()
            }}
          >
            Send
          </div>
        </div>
      </div>
    </div>
  )
}
