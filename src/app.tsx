import React, { useEffect, useMemo, useState } from 'react'
import { motion } from '@gpuix/react'
import {
  DEFAULT_AGENTS,
  emptyThreads,
  isMouthBusy,
  type Agent,
  type FeedItem,
  type JobHandle,
} from './domain'
import { abandonJob, ensureDispatched } from './runtime/jobs'
import { adoptMarionetteOpenRouterKey } from './runtime/keys'
import { ensureMouth } from './runtime/mouth'
import { openStaffStore } from './runtime/store'
import {
  attachPmJob,
  completeJob,
  completeMouth,
  confirmFanout,
  dismissFanout,
  failJob,
  failMouth,
  runningJobs,
  send,
  setActive,
  setDraft,
  stopJob,
  type Session,
} from './session'
import { CHAT_THEME, T } from './tokens'

const TRAFFIC =
  typeof process !== 'undefined' && process.platform === 'darwin'
    ? T.layout.trafficLightClearance
    : T.space.sm

function emptySeed(): Session {
  return {
    agents: DEFAULT_AGENTS,
    activeAgentId: 'staff',
    threads: emptyThreads(DEFAULT_AGENTS),
    jobs: [],
    pendingFanout: null,
  }
}

export function App() {
  const store = useMemo(() => {
    adoptMarionetteOpenRouterKey()
    return openStaffStore()
  }, [])
  const [session, setSession] = useState<Session>(() => store.load() ?? emptySeed())
  const active = session.agents.find((agent) => agent.id === session.activeAgentId)
  const thread = session.threads[session.activeAgentId]
  const jobs = runningJobs(session)

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
  }, [store, session.threads.staff.mouth, session.threads.kernel.mouth, session.threads.research.mouth])

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
    setSession((current) => send(current, current.threads[current.activeAgentId].draft))
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
    >
      <Rail
        session={session}
        onSelect={(id) => setSession((current) => setActive(current, id))}
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
        <Titlebar name={active?.name ?? 'Staff'} title={active?.title ?? ''} />
        <Feed items={thread.items} agents={session.agents} />
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
          <FanoutCard
            names={session.pendingFanout.targets
              .map((id) => session.agents.find((agent) => agent.id === id)?.name)
              .filter(Boolean)
              .join(', ')}
            onConfirm={() => setSession((current) => confirmFanout(current))}
            onDismiss={() => setSession((current) => dismissFanout(current))}
          />
        ) : null}
        <Composer
          value={thread.draft}
          locked={isMouthBusy(thread.mouth)}
          onChange={(value) => setSession((current) => setDraft(current, value))}
          onSend={onSend}
        />
      </div>
    </div>
  )
}
function Rail({
  session,
  onSelect,
}: {
  session: Session
  onSelect: (id: string) => void
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
        height: '100%',
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
      {agents.map((agent) => {
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
              cursor: 'pointer',
              backgroundColor: selected ? T.overlayStrong : T.clear,
              hover: { backgroundColor: selected ? T.overlayStrong : T.overlay },
              userSelect: 'none',
            }}
            onClick={() => onSelect(agent.id)}
          >
            <div
              style={{
                width: T.size.dot,
                height: T.size.dot,
                borderRadius: T.radius.dot,
                backgroundColor: isMouthBusy(row.mouth) ? agent.color : T.ghost,
                flexShrink: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: T.type.md, color: T.text }}>{agent.name}</div>
              <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{agent.title}</div>
            </div>
            {row.unread > 0 ? (
              <div
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
              </div>
            ) : null}
          </div>
        )
      })}
    </motion.div>
  )
}
function Titlebar({ name, title }: { name: string; title: string }) {
  return (
    <div
      style={{
        height: T.layout.titlebarHeight,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: T.space.lg,
        paddingRight: T.space.lg,
        borderBottomWidth: T.stroke.hairline,
        borderBottomColor: T.border,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: T.type.md, color: T.text }}>{name}</div>
      <div style={{ fontSize: T.type.sm, color: T.tertiary, marginLeft: T.space.sm }}>{title}</div>
    </div>
  )
}

function Feed({ items, agents }: { items: FeedItem[]; agents: Agent[] }) {
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id
  return (
    <div
      testId="feed"
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
        gap: T.space.md,
      }}
    >
      {items.length === 0 ? (
        <div style={{ color: T.tertiary, fontSize: T.type.md }}>
          Send stays Send. Jobs are handles, not chat.
        </div>
      ) : null}
      {items.map((item) => {
        if (item.kind === 'agent_note') {
          return (
            <div key={item.id} style={{ fontSize: T.type.sm, color: T.tertiary }}>
              {nameOf(item.fromId)} → {nameOf(item.toId)}: {item.text}
            </div>
          )
        }
        const mine = item.from === 'user'
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: mine ? 'flex-end' : 'flex-start',
            }}
          >
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
                color: T.text,
              }}
            >
              {item.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function JobStrip({
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
            <div style={{ fontSize: T.type.sm, color: T.secondary, flexGrow: 1 }}>
              {owner?.name ?? 'Agent'} · {job.kind} · {job.goal}
            </div>
            <div
              testId={`stop-${job.id}`}
              style={{
                paddingLeft: T.space.sm,
                paddingRight: T.space.sm,
                paddingTop: T.space.xs,
                paddingBottom: T.space.xs,
                borderRadius: T.radius.sm,
                backgroundColor: T.overlay,
                fontSize: T.type.xs,
                color: T.text,
                cursor: 'pointer',
                userSelect: 'none',
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

function FanoutCard({
  names,
  onConfirm,
  onDismiss,
}: {
  names: string
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <div
      testId="fanout-confirm"
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
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>
        Message {names}? This fans out.
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
        <div
          testId="fanout-confirm-yes"
          style={{
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.xs,
            paddingBottom: T.space.xs,
            borderRadius: T.radius.sm,
            backgroundColor: T.inverse,
            color: T.onInverse,
            fontSize: T.type.sm,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={onConfirm}
        >
          Send
        </div>
        <div
          testId="fanout-confirm-no"
          style={{
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.xs,
            paddingBottom: T.space.xs,
            borderRadius: T.radius.sm,
            backgroundColor: T.overlay,
            color: T.text,
            fontSize: T.type.sm,
            cursor: 'pointer',
            userSelect: 'none',
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
  locked,
  onChange,
  onSend,
}: {
  value: string
  locked: boolean
  onChange: (value: string) => void
  onSend: () => void
}) {
  const ready = value.trim().length > 0 && !locked
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
            backgroundColor: T.clear,
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
            justifyContent: 'flex-end',
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.sm,
          }}
        >
          <div
            testId="send"
            style={{
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.control,
              paddingBottom: T.space.control,
              borderRadius: T.radius.sm,
              backgroundColor: ready ? T.inverse : T.overlay,
              color: ready ? T.onInverse : T.tertiary,
              fontSize: T.type.sm,
              cursor: ready ? 'pointer' : 'default',
              userSelect: 'none',
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
