import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { existsSync } from 'node:fs'
import { motion, useGpuix } from '@gpuix/react'
import {
  DEFAULT_AGENTS,
  bindHomes,
  createAgentNames,
  emptyThreads,
  isMouthBusy,
  lastSpoken,
  nextId,
  previousPaintedFeedItem,
  sameFeedVoice,
  shouldShowFeedClock,
  feedClock,
  feedThinking,
  thinkingDots,
  jobKindLabel,
  type Agent,
  type FeedItem,
  type JobHandle,
  type MouthState,
  visibleAgents,
} from './domain'
import { ingestPath, insertClipboardText, pickLocalFiles, readClipboardPaths, readClipboardText } from './runtime/attachments'
import { watchPasteHotkey } from './runtime/paste-hotkey'
import { clockDuration, runningTests } from './runtime/test-env'
import { abandonJob, ensureDispatched } from './runtime/jobs'
import { createAgent, destroyAgent, ensureMarkFrames, hydrateSession, liveAgentFromProfile, applyHomeBinds } from './runtime/factory'
import { adoptMarionetteOpenRouterKey } from './runtime/keys'
import { ensureMouth } from './runtime/mouth'
import { kitForAgent, readProfile, writeProfile, type AgentProfile } from './runtime/profile'
import { openStaffStore, type StaffStore } from './runtime/store'
import { claimTaskKey } from './runtime/working-set'
import {
  Inspector,
  inspectorChord,
  isStoreAnswer,
  kernelSandboxHint,
  pasteChord,
  quitChord,
} from './inspector'
import { DeskStage } from './desk'
import { ensureBox } from './runtime/box'
import { browse, ensureBrowser } from './runtime/chrome'
import { ensureScreen } from './runtime/screen'
import {
  addLiveAgent,
  attachPmJob,
  completeJob,
  completeMouth,
  confirmDeskHandoff,
  confirmFanout,
  dismissDeskHandoff,
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
import { SisterBlob, framePath, markFor } from './blob'
import { railDragOrigin, railIsCompact, railWidthFromDrag, readSkin, writeSkin } from './runtime/skin'
import { Settings } from './settings'
import { CHAT_THEME, T } from './tokens'
import { MARK_PATH, PRODUCT } from './brand'

type Pane = 'none' | 'inspector' | 'settings'
type RailMenuAt = { id: string; x: number; y: number }

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
  const [railWidth, setRailWidth] = useState(() => readSkin().railWidth)
  const [railDragging, setRailDragging] = useState(false)
  const [railMenu, setRailMenu] = useState<RailMenuAt | null>(null)
  const [deskControl, setDeskControl] = useState(false)
  const railDrag = useRef<{ startX: number; startWidth: number } | null>(null)
  const railPoint = useRef<number | null>(null)
  const railWidthRef = useRef(railWidth)
  railWidthRef.current = railWidth

  const startRail = (event: { x?: number } = {}) => {
    const width = railWidthRef.current
    const startX =
      typeof event.x === 'number' && Number.isFinite(event.x) ? event.x : railDragOrigin(width)
    railDrag.current = { startX, startWidth: width }
    railPoint.current = startX
    setRailDragging(true)
  }

  const moveRail = (event: { x?: number }) => {
    if (!railDrag.current) return
    const x = Number.isFinite(event.x) ? event.x : railPoint.current
    if (x == null) return
    railPoint.current = x
    setRailWidth(railWidthFromDrag(railDrag.current.startWidth, railDrag.current.startX, x))
  }

  const endRail = () => {
    if (!railDrag.current) return
    railDrag.current = null
    railPoint.current = null
    setRailDragging(false)
    writeSkin({ ...readSkin(), railWidth: railWidthRef.current })
  }
  const skipSelect = useRef(false)
  const pasteBusy = useRef(false)
  const active = session.agents.find((agent) => agent.id === session.activeAgentId)
  const thread = session.threads[session.activeAgentId]
  const jobs = runningJobs(session)
  const metrics = store.metrics()
  const claims = store.listClaims()
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
    if (runningTests()) return
    ensureBox()
    ensureScreen(session.activeAgentId)
  }, [])

  useEffect(() => {
    const req = session.deskOpen
    if (!req || runningTests()) return
    const { agentId, url } = req
    void (async () => {
      await browse(agentId, url)
      setSession((current) => {
        if (!current.deskOpen || current.deskOpen.agentId !== agentId || current.deskOpen.url !== url) {
          return current
        }
        return { ...current, deskOpen: null }
      })
    })()
  }, [session.deskOpen?.agentId, session.deskOpen?.url])

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
            if (job.kind !== 'box-shell') {
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
            }
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
      let working = current
      if (kitForAgent(working.activeAgentId) === 'coordinator') {
        const draft = row.draft.trim()
        for (const name of createAgentNames(draft)) {
          const created = createAgent({ name, kit: 'code' })
          working = addLiveAgent(working, created.agent, false)
        }
        for (const agent of applyHomeBinds(bindHomes(draft, visibleAgents(working.agents)))) {
          working = patchLiveAgent(working, agent)
        }
      }
      let next = send(working, row.draft, ids)
      if (kitForAgent(next.activeAgentId) === 'coordinator') {
        const draft = row.draft.trim()
        for (const agent of next.agents) {
          const profile = readProfile(agent.id)
          if (!profile || profile.name === agent.name) continue
          writeProfile({ ...profile, name: agent.name, namedBy: 'user' })
        }
        for (const agent of applyHomeBinds(bindHomes(draft, visibleAgents(next.agents)))) {
          next = patchLiveAgent(next, agent)
        }
      }
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

  const enqueueClipboard = () => {
    if (pasteBusy.current) return
    pasteBusy.current = true
    try {
      const paths = readClipboardPaths()
      if (paths.length > 0) {
        setSession((current) => queuePaths(current, paths))
        return
      }
      const text = readClipboardText()
      if (!text) return
      setSession((current) => {
        const draft = current.threads[current.activeAgentId]?.draft ?? ''
        return setDraft(current, insertClipboardText(draft, text))
      })
    } finally {
      queueMicrotask(() => {
        pasteBusy.current = false
      })
    }
  }

  const enqueueClipboardRef = useRef(enqueueClipboard)
  enqueueClipboardRef.current = enqueueClipboard

  useEffect(() => {
    if (runningTests()) return
    return watchPasteHotkey(() => enqueueClipboardRef.current())
  }, [])

  const onCreateAgent = () => {
    setRailMenu(null)
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
    if (patch.avatarShape || patch.avatarColor) {
      ensureMarkFrames(next.avatarShape, next.avatarColor)
    }
    setSession((row) => patchLiveAgent(row, liveAgentFromProfile(next)))
  }

  return (
    <div
      testId="app"
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: T.canvas,
        color: T.text,
      }}
      onMouseMove={railDragging ? moveRail : undefined}
      onMouseUp={railDragging ? endRail : undefined}
      onMouseDown={(event) => {
        if (event.isRightClick || event.button === 2) return
        setRailMenu(null)
      }}
      onKeyDown={(event) => {
        if (inspectorChord(event)) toggleInspector()
        if (pasteChord(event)) enqueueClipboard()
        if (quitChord(event) && !runningTests()) process.exit(0)
      }}
    >
      <motion.div
        initial={false}
        animate={{ width: railWidth }}
        transition={{ duration: railDragging ? 0 : clockDuration(T.motion.pane), ease: 'easeOut' }}
        style={{
          width: railWidth,
          height: '100%',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <Rail
          session={session}
          width={railWidth}
          onSelect={(id) => {
            if (skipSelect.current) {
              skipSelect.current = false
              return
            }
            setRailMenu(null)
            setSession((current) => setActive(current, id))
            setPane((current) => (current === 'settings' ? 'none' : current))
          }}
          onCreate={onCreateAgent}
          onMenu={(id, event) => {
            const x = typeof event.x === 'number' && Number.isFinite(event.x) ? event.x : railWidth
            const y = typeof event.y === 'number' && Number.isFinite(event.y) ? event.y : T.layout.titlebarHeight
            setRailMenu((current) => (current?.id === id ? null : { id, x, y }))
          }}
          onSettings={() => {
            setRailMenu(null)
            setPane((current) => (current === 'settings' ? 'none' : 'settings'))
          }}
        />
      </motion.div>
      <RailResize
        dragging={railDragging}
        onDown={startRail}
        onMove={moveRail}
        onUp={endRail}
      />
      <div
        testId="stage"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          backgroundColor: T.canvas,
        }}
      >
        <Titlebar name={active?.name ?? PRODUCT} onInspect={toggleInspector} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexGrow: 1,
            minHeight: 0,
            minWidth: 0,
            backgroundColor: T.canvas,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              minHeight: 0,
              minWidth: 0,
            }}
          >
            <Feed
              key={session.activeAgentId}
              items={thread?.items ?? []}
              mouth={thread?.mouth ?? 'idle'}
              agents={session.agents}
              dockPad={jobs.length > 0 ? T.jobStrip.height : 0}
              storeAnswer={(userItemId) => isStoreAnswer(store, userItemId)}
              attachmentsFor={(ids) =>
                ids.flatMap((id) => store.listAttachments().filter((row) => row.id === id))
              }
            />
            <div
              testId="dock"
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                backgroundColor: T.canvas,
              }}
            >
              <motion.div
                initial={false}
                animate={{ height: jobs.length > 0 ? T.jobStrip.height : 0 }}
                transition={{ duration: clockDuration(T.motion.strip), ease: 'easeOut' }}
                style={{
                  height: jobs.length > 0 ? T.jobStrip.height : 0,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
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
              </motion.div>
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
              ) : session.deskHandoff ? (
                <ConfirmCard
                  testId="desk-handoff"
                  prompt={session.deskHandoff.instruction}
                  confirmId="desk-handoff-yes"
                  dismissId="desk-handoff-no"
                  confirmLabel="Take control"
                  onConfirm={() => {
                    const agentId = session.deskHandoff?.agentId
                    setSession((current) => confirmDeskHandoff(current))
                    setDeskControl(true)
                    if (agentId) void ensureBrowser(agentId)
                  }}
                  onDismiss={() => setSession((current) => dismissDeskHandoff(current))}
                />
              ) : null}
              <Composer
                value={thread?.draft ?? ''}
                pendingPaths={thread?.pendingPaths ?? []}
                locked={!thread || isMouthBusy(thread.mouth)}
                onChange={(value) => setSession((current) => setDraft(current, value))}
                onAttach={onAttach}
                onPaste={enqueueClipboard}
                onDropPending={(path) => setSession((current) => dropPendingPath(current, path))}
                onSend={onSend}
              />
            </div>
          </div>
          <SlidePane testId="inspector-pane" open={pane === 'inspector' && Boolean(active)}>
            {pane === 'inspector' && active ? (
              <Inspector
                agent={active}
                profile={profile}
                claims={claims}
                sandboxHint={sandboxHint}
                onClose={() => setPane('none')}
                onPatch={onPatchProfile}
                controlling={deskControl}
                onTakeControl={() => {
                  setDeskControl((on) => {
                    const next = !on
                    if (next) void ensureBrowser(active.id)
                    return next
                  })
                }}
              />
            ) : null}
          </SlidePane>
          <SlidePane testId="settings-pane" open={pane === 'settings'}>
            {pane === 'settings' ? <Settings metrics={metrics} onClose={() => setPane('none')} /> : null}
          </SlidePane>
        </div>
      </div>
      {deskControl && active ? (
        <DeskStage
          agentId={active.id}
          name={active.name}
          left={railWidth + T.layout.railHandle}
          open={deskControl}
          onRelease={() => setDeskControl(false)}
        />
      ) : null}
      {railDragging ? (
        <div
          testId="rail-drag"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
            cursor: 'col-resize',
            userSelect: 'none',
          }}
          onMouseMove={moveRail}
          onMouseUp={endRail}
        />
      ) : null}
      {railMenu ? (
        <RailMenu
          x={railMenu.x}
          y={railMenu.y}
          onDelete={() => {
            skipSelect.current = true
            destroyAgent(railMenu.id)
            setSession((current) => dropLiveAgent(current, railMenu.id))
            setRailMenu(null)
          }}
          onClose={() => setRailMenu(null)}
        />
      ) : null}
    </div>
  )
}
function RailResize({
  dragging,
  onDown,
  onMove,
  onUp,
}: {
  dragging: boolean
  onDown: (event: { x?: number }) => void
  onMove: (event: { x?: number }) => void
  onUp: () => void
}) {
  return (
    <div
      testId="rail-resize"
      style={{
        width: T.layout.railHandle,
        height: '100%',
        flexShrink: 0,
        backgroundColor: T.canvas,
        borderLeftWidth: T.stroke.hairline,
        borderLeftColor: dragging ? T.borderStrong : T.border,
        hover: { borderLeftColor: T.borderStrong },
        cursor: 'col-resize',
        userSelect: 'none',
      }}
      onMouseDown={(event) => {
        if (event.isRightClick || event.button === 2) return
        onDown(event)
      }}
      onMouseMove={onMove}
      onMouseUp={onUp}
    />
  )
}

function RailMenu({
  x,
  y,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <div
      testId="rail-menu"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        minWidth: T.layout.menuMin,
        backgroundColor: T.raised,
        borderWidth: T.stroke.hairline,
        borderColor: T.border,
        borderRadius: T.radius.sm,
        paddingTop: T.space.xs,
        paddingBottom: T.space.xs,
        pointerEvents: 'auto',
      }}
      onMouseDownOutside={onClose}
    >
      <div
        testId="rail-menu-delete"
        style={{
          paddingLeft: T.space.md,
          paddingRight: T.space.md,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          color: T.danger,
          fontSize: T.type.sm,
          whiteSpace: 'nowrap',
          ...HIT,
          hover: { backgroundColor: T.selected },
        }}
        onMouseDown={(event) => {
          if (event.isRightClick || event.button === 2) return
          onDelete()
        }}
        onClick={(event) => {
          if (event.isRightClick || event.button === 2) return
          onDelete()
        }}
      >
        Delete
      </div>
    </div>
  )
}

function PlusMark() {
  return (
    <div
      testId="new-agent-icon"
      style={{
        width: T.blob.enterSize,
        height: T.blob.enterSize,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        color: T.secondary,
        fontSize: T.type.lg,
      }}
    >
      +
    </div>
  )
}

function GearMark() {
  const size = T.blob.enterSize
  const spoke = T.space.xs
  const mid = (size - spoke) / 2
  const hub = T.space.md
  const hubInset = (size - hub) / 2
  const teeth = [
    { left: mid, top: 0, width: spoke, height: spoke + T.space.xxs },
    { left: mid, top: size - spoke - T.space.xxs, width: spoke, height: spoke + T.space.xxs },
    { left: 0, top: mid, width: spoke + T.space.xxs, height: spoke },
    { left: size - spoke - T.space.xxs, top: mid, width: spoke + T.space.xxs, height: spoke },
    { left: T.space.xxs, top: T.space.xxs, width: spoke, height: spoke },
    { left: size - spoke - T.space.xxs, top: T.space.xxs, width: spoke, height: spoke },
    { left: T.space.xxs, top: size - spoke - T.space.xxs, width: spoke, height: spoke },
    { left: size - spoke - T.space.xxs, top: size - spoke - T.space.xxs, width: spoke, height: spoke },
  ]
  return (
    <div
      testId="settings-icon"
      style={{
        width: size,
        height: size,
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      {teeth.map((box, index) => (
        <div
          key={index}
          style={{ position: 'absolute', pointerEvents: 'none', backgroundColor: T.secondary, ...box }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: hubInset,
          top: hubInset,
          width: hub,
          height: hub,
          borderRadius: hub / 2,
          backgroundColor: T.secondary,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function Rail({
  session,
  width,
  onSelect,
  onCreate,
  onMenu,
  onSettings,
}: {
  session: Session
  width: number
  onSelect: (id: string) => void
  onCreate: () => void
  onMenu: (id: string, event: { x?: number; y?: number }) => void
  onSettings: () => void
}) {
  const agents = session.agents.filter((agent) => !agent.hidden)
  const compact = railIsCompact(width)
  const rowPad = compact ? T.space.xs : T.space.md
  const rowMargin = compact ? T.space.xs : T.space.sm

  return (
    <div
      testId="rail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        width,
        height: '100%',
        overflow: 'hidden',
        backgroundColor: T.sidebar,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          height: T.layout.titlebarHeight,
          paddingLeft: compact ? T.space.sm : TRAFFIC,
          paddingRight: T.space.sm,
          flexShrink: 0,
        }}
      />
      {agents.map((agent, index) => {
        const row = session.threads[agent.id]
        const selected = agent.id === session.activeAgentId
        return (
          <div
            key={agent.id}
            testId={`agent-${agent.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: compact ? 'center' : 'stretch',
              alignSelf: compact ? 'center' : 'stretch',
              paddingLeft: rowPad,
              paddingRight: rowPad,
              paddingTop: T.space.sm,
              paddingBottom: T.space.sm,
              marginLeft: rowMargin,
              marginRight: rowMargin,
              marginBottom: T.space.xxs,
              borderRadius: T.radius.sm,
              ...HIT,
              backgroundColor: selected ? T.selected : T.sidebar,
              hover: { backgroundColor: T.selected },
              active: { backgroundColor: T.selected },
            }}
            onClick={(event) => {
              if (event.isRightClick || event.button === 2) return
              onSelect(agent.id)
            }}
            onMouseDown={(event) => {
              if (event.isRightClick || event.button === 2) onMenu(agent.id, event)
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: compact ? 'center' : 'flex-start',
                gap: compact ? 0 : T.space.sm,
                width: '100%',
              }}
            >
            <div style={{ position: 'relative', flexShrink: 0 }}>
            <SisterBlob
              agent={agent}
              selected={selected}
              unread={row?.unread ?? 0}
              mouthBusy={isMouthBusy(row?.mouth ?? 'idle')}
              index={index}
            />
            {row?.unread ? (
              <motion.div
                initial={{ opacity: 0, width: 0, height: T.size.badge }}
                animate={{ opacity: 1, width: T.size.badge, height: T.size.badge }}
                transition={{ duration: clockDuration(T.motion.unread), ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
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
            {compact ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: T.type.md,
                    color: T.text,
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {agent.name}
                </div>
                <SpokenLine text={row ? lastSpoken(row, agent.title) : agent.title} />
              </div>
            )}
            </div>
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
          justifyContent: compact ? 'center' : 'flex-start',
          gap: compact ? 0 : T.space.sm,
          paddingLeft: rowPad,
          paddingRight: rowPad,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          marginLeft: rowMargin,
          marginRight: rowMargin,
          marginBottom: T.space.xxs,
          borderRadius: T.radius.sm,
          minHeight: T.blob.slot,
          ...HIT,
          backgroundColor: T.sidebar,
          hover: { backgroundColor: T.selected },
        }}
        onClick={onCreate}
      >
        <PlusMark />
        {compact ? null : <div style={{ fontSize: T.type.sm, color: T.secondary }}>New automaton</div>}
      </div>
      <div
        testId="settings-open"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: compact ? 0 : T.space.sm,
          paddingLeft: rowPad,
          paddingRight: rowPad,
          paddingTop: T.space.sm,
          paddingBottom: T.space.sm,
          marginLeft: rowMargin,
          marginRight: rowMargin,
          marginBottom: T.space.md,
          borderRadius: T.radius.sm,
          minHeight: T.blob.slot,
          ...HIT,
          backgroundColor: T.sidebar,
          hover: { backgroundColor: T.selected },
        }}
        onClick={onSettings}
      >
        <GearMark />
        {compact ? null : <div style={{ fontSize: T.type.sm, color: T.secondary }}>Settings</div>}
      </div>
    </div>
  )
}
function Titlebar({
  name,
  onInspect,
}: {
  name: string
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
        paddingLeft: TRAFFIC,
        paddingRight: T.space.lg,
        gap: T.space.sm,
        borderBottomWidth: T.stroke.hairline,
        borderBottomColor: T.border,
        backgroundColor: T.canvas,
        ...HIT,
        flexShrink: 0,
      }}
      onClick={onInspect}
    >
      <img
        src={MARK_PATH}
        alt=""
        objectFit="contain"
        style={{ width: T.brand.mark, height: T.brand.mark, pointerEvents: 'none' }}
      />
      <div testId="titlebar-brand" style={{ fontSize: T.type.md, color: T.text }}>
        {PRODUCT}
      </div>
      <div testId="titlebar-name" style={{ fontSize: T.type.md, color: T.text }}>
        {name}
      </div>
    </div>
  )
}

function SpokenLine({ text }: { text: string }) {
  return (
    <motion.div
      key={text}
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ duration: clockDuration(T.motion.unread), ease: 'easeOut' }}
      style={{
        fontSize: T.type.xs,
        color: T.tertiary,
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </motion.div>
  )
}

function SlidePane({
  open,
  testId,
  children,
}: {
  open: boolean
  testId: string
  children: React.ReactNode
}) {
  const width = open ? T.inspector.width : 0
  return (
    <div
      testId={testId}
      style={{
        width,
        height: '100%',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <motion.div
        initial={false}
        animate={{ width }}
        transition={{ duration: clockDuration(T.motion.pane), ease: 'easeOut' }}
        style={{
          width,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: T.inspector.width, height: '100%', minHeight: 0 }}>{children}</div>
      </motion.div>
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
  flexGrow: 1,
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  paddingTop: T.feed.turn,
  paddingBottom: T.feed.turn,
}

const feedLane = {
  paddingLeft: T.feed.gutter,
  paddingRight: T.feed.gutter,
}

function feedTailKey(items: FeedItem[], dockPad: number, thinking: boolean): string {
  const last = items.at(-1)
  if (!last) return `empty:${dockPad}:${thinking ? 't' : 'f'}`
  const grown = last.kind === 'msg' ? last.text.length : 0
  return `${items.length}:${last.id}:${grown}:${dockPad}:${thinking ? 't' : 'f'}`
}

const FEED_TAIL = -1_000_000

function pinFeedTail(
  renderer: {
    scrollTo?: (id: number, x: number, y: number) => void
    scrollToItem?: (id: number, index: number) => void
  } | null,
  node: { id: number } | null,
  items: FeedItem[],
  thinking: boolean,
) {
  if (!renderer || !node) return
  const count = paintedFeedCount(items, thinking)
  if (count > 0) renderer.scrollToItem?.(node.id, count - 1)
  renderer.scrollTo?.(node.id, 0, FEED_TAIL)
}

function RelayMark({
  lane,
  peerId,
  agents,
}: {
  lane: 'sent' | 'from'
  peerId: string
  agents: Agent[]
}) {
  const peer = agents.find((agent) => agent.id === peerId)
  const mark = markFor(peer ?? { id: peerId })
  const rest = framePath(mark.shape, mark.tint, 'rest')
  const label = lane === 'sent' ? `Sent to ${peer?.name ?? peerId}` : `Message from ${peer?.name ?? peerId}`
  return (
    <div
      testId={`relay-${lane}-${peerId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: T.space.sm,
        width: '100%',
        paddingTop: T.feed.mark,
        paddingBottom: T.feed.mark,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: T.space.sm,
        }}
      >
        <div style={{ flexGrow: 1, height: T.stroke.hairline, backgroundColor: T.border }} />
        {existsSync(rest) ? (
          <img
            src={rest}
            objectFit="contain"
            alt=""
            style={{ width: T.size.badge, height: T.size.badge }}
          />
        ) : null}
        <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{label}</div>
        <div style={{ flexGrow: 1, height: T.stroke.hairline, backgroundColor: T.border }} />
      </div>
    </div>
  )
}

function TimeMark({ at }: { at: number }) {
  return (
    <div
      testId="feed-clock"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: T.space.sm,
        width: '100%',
        ...feedLane,
        paddingTop: T.feed.mark,
        paddingBottom: T.feed.mark,
      }}
    >
      <div style={{ flexGrow: 1, height: T.stroke.hairline, backgroundColor: T.border }} />
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{feedClock(at)}</div>
      <div style={{ flexGrow: 1, height: T.stroke.hairline, backgroundColor: T.border }} />
    </div>
  )
}

function FeedGutterEnd({ pad = 0 }: { pad?: number }) {
  return (
    <div
      testId="feed-gutter-end"
      style={{
        width: T.feed.gutter + pad,
        flexShrink: 0,
        minHeight: T.stroke.hairline,
        backgroundColor: T.canvas,
      }}
    />
  )
}

function paintedFeedCount(items: FeedItem[], thinking = false): number {
  if (items.length === 0) return 1
  let count = 0
  for (const item of items) {
    if (item.kind === 'relay' && item.lane === 'from') continue
    if (item.kind === 'agent_note') continue
    if (item.kind === 'relay' || item.kind === 'msg') count += 1
  }
  return thinking ? count + 1 : count
}

function ThinkingRow() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (runningTests()) return
    const timer = setInterval(() => setStep((n) => n + 1), T.feed.thinkMs)
    return () => clearInterval(timer)
  }, [])
  return (
    <div
      testId="thinking"
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        width: '100%',
        paddingTop: T.feed.turn,
        paddingLeft: T.feed.gutter,
        paddingRight: T.feed.gutter,
        fontSize: T.type.md,
        lineHeight: T.line.md,
        color: T.tertiary,
      }}
    >
      {thinkingDots(step)}
    </div>
  )
}

export function Feed({
  items,
  agents,
  storeAnswer,
  attachmentsFor,
  dockPad = 0,
  mouth = 'idle',
}: {
  items: FeedItem[]
  agents: Agent[]
  storeAnswer: (userItemId: string) => boolean
  attachmentsFor?: (ids: string[]) => { id: string; path: string; kind: 'image' | 'file' }[]
  dockPad?: number
  mouth?: MouthState
}) {
  const ref = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const thinking = feedThinking(mouth, items)
  const pin = feedTailKey(items, dockPad, thinking)
  useLayoutEffect(() => {
    pinFeedTail(renderer, ref.current, items, thinking)
  }, [pin, items, renderer, thinking])
  useEffect(() => {
    pinFeedTail(renderer, ref.current, items, thinking)
  }, [pin, items, renderer, thinking])
  return (
    <virtual-list
      ref={ref}
      testId="feed"
      alignment="bottom"
      followTail
      estimatedItemHeight={T.line.lg * 3}
      style={feedScrollStyle}
    >
      {items.length === 0 ? (
        <div testId="feed-empty" style={{ color: T.tertiary, fontSize: T.type.md, ...feedLane }}>
          Start shipping. No strings attached.
        </div>
      ) : null}
      {items.map((item, index) => {
        if (item.kind === 'relay') {
          if (item.lane === 'from') return null
          return (
            <div key={item.id} style={feedLane}>
              <RelayMark lane={item.lane} peerId={item.peerId} agents={agents} />
            </div>
          )
        }
        if (item.kind === 'agent_note') return null
        if (item.kind !== 'msg') return null
        const inbound = items[index - 1]
        const fromPeer = inbound?.kind === 'agent_note' ? inbound.fromId : null
        const mine = item.from === 'user' && !fromPeer
        const prev = previousPaintedFeedItem(items, index)
        const showClock = shouldShowFeedClock(prev, item)
        const gapBefore = showClock ? 0 : sameFeedVoice(prev, item, Boolean(fromPeer)) ? T.feed.stack : T.feed.turn
        const userItemId = mine ? null : precedingUserId(items, index)
        const fromStore = userItemId ? storeAnswer(userItemId) : false
        const files = item.attachmentIds?.length ? attachmentsFor?.(item.attachmentIds) ?? [] : []
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              width: '100%',
              paddingTop: prev ? gapBefore : 0,
            }}
          >
            {showClock && item.at != null ? <TimeMark at={item.at} /> : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: fromPeer ? 'stretch' : mine ? 'flex-end' : 'flex-start',
                gap: T.space.sm,
                width: '100%',
                paddingLeft: mine ? 0 : T.feed.gutter,
              }}
            >
            {files.map((file) => (
            <div
              key={file.id}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
              }}
            >
              {file.kind === 'image' ? (
                <div testId={`thumb-${file.id}`}>
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
                <div testId={`file-${file.id}`}>
                  <code code={file.path} language="text" theme={CHAT_THEME} />
                </div>
              )}
              {mine ? <FeedGutterEnd /> : null}
            </div>
            ))}
            {item.text ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
              }}
            >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: clockDuration(T.motion.enter), ease: 'easeOut' }}
            >
            <div
              testId={mine ? 'bubble-mine' : 'bubble-theirs'}
              style={{
                maxWidth: T.feed.max,
                backgroundColor: mine ? T.selected : T.composer,
                borderRadius: T.radius.lg,
                paddingTop: T.feed.padY,
                paddingBottom: T.feed.padY,
                paddingLeft: T.feed.padX,
                paddingRight: T.feed.padX,
                fontSize: T.type.md,
                lineHeight: T.line.md,
                minHeight: T.line.md,
                color: T.text,
              }}
            >
              {mine ? item.text : <markdown source={item.text} theme={CHAT_THEME} />}
            </div>
            </motion.div>
            {mine ? <FeedGutterEnd pad={T.feed.padX} /> : null}
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
            {fromPeer ? (
              <RelayMark key={`from-${item.id}`} lane="from" peerId={fromPeer} agents={agents} />
            ) : null}
            </div>
          </div>
        )
      })}
      {thinking ? <ThinkingRow /> : null}
    </virtual-list>
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
        minHeight: T.jobStrip.height,
        paddingTop: T.space.sm,
        paddingBottom: T.space.sm,
        borderTopWidth: T.stroke.hairline,
        borderTopColor: T.border,
        backgroundColor: T.canvas,
        flexShrink: 0,
      }}
    >
      {jobs.map((job) => {
        const owner = agents.find((agent) => agent.id === job.ownerAgentId)
        const label = `${owner?.name ?? 'Agent'} · ${jobKindLabel(job.kind)} · ${job.goal}`
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
  onPaste,
  onDropPending,
  onSend,
}: {
  value: string
  pendingPaths: string[]
  locked: boolean
  onChange: (value: string) => void
  onAttach: () => void
  onPaste: () => void
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
        paddingLeft: T.feed.gutter,
        paddingRight: T.feed.gutter,
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
          placeholder="Message this automaton"
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
          onKeyDown={(event) => {
            if (pasteChord(event)) onPaste()
            if (quitChord(event) && !runningTests()) process.exit(0)
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
              hover: { backgroundColor: T.selected },
            }}
            onClick={(event) => {
              if (event.isRightClick || event.button === 2) return
              onAttach()
            }}
            onMouseDown={(event) => {
              if (event.isRightClick || event.button === 2) onPaste()
            }}
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
              color: ready ? T.onInverse : T.ghost,
              fontSize: T.type.sm,
              ...HIT,
              cursor: ready ? 'pointer' : 'default',
              hover: ready ? { opacity: T.blob.hover } : undefined,
              active: ready ? { opacity: T.blob.active } : undefined,
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
