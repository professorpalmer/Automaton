import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { existsSync } from 'node:fs'
import { flushSync, motion, useGpuix } from '@gpuix/react'
import {
  DEFAULT_AGENTS,
  bindHomes,
  composerEnterBusy,
  createAgentNames,
  emptyThreads,
  isMouthBusy,
  lastSpoken,
  createPendingSendView,
  mergePendingFeed,
  nextId,
  previousPaintedFeedItem,
  sameFeedVoice,
  sessionCoversPending,
  shouldQueueSteer,
  shouldShowFeedClock,
  feedClock,
  feedThinking,
  thinkingDots,
  oldestWaitingUserGoal,
  type Agent,
  type FeedItem,
  type GoalRun,
  type MouthState,
  type PendingSendView,
  type WidgetAnswer,
  visibleAgents,
} from './domain'
import { ingestPath, insertClipboardText, pickLocalFiles, readClipboardPaths, readClipboardText } from './runtime/attachments'
import { watchCopyHotkey, watchCutHotkey, watchPasteHotkey, watchQuitHotkey, watchSelectAllHotkey } from './runtime/paste-hotkey'
import { clockDuration, runningTests } from './runtime/test-env'
import { applyUpdate, checkForUpdate, dismissUpdate, readDismissedSha, shouldOfferUpdate, relaunchAutomaton, type UpdateOffer } from './runtime/updates'
import { copyTextToClipboard } from './runtime/clipboard'
import { copyFeedSelection, feedMsgIds, selectFeedRange } from './runtime/feed-select'
import { abandonJob, claimRepoForJob, ensureDispatched, isLiveAnalyzeGoal } from './runtime/jobs'
import { createAgent, destroyAgent, ensureMarkFrames, hydrateSession, liveAgentFromProfile, applyHomeBinds } from './runtime/factory'
import { adoptMarionetteOpenRouterKey, listOpenRouterKeys } from './runtime/keys'
import { dropMouthStarts, ensureMouth } from './runtime/mouth'
import { kitForAgent, markIntroPlayedAt, readProfile, writeProfile, type AgentProfile } from './runtime/profile'
import { openStaffStore, type StaffStore } from './runtime/store'
import { claimTaskKey } from './runtime/working-set'
import {
  Inspector,
  copyChord,
  cutChord,
  inspectorChord,
  isStoreAnswer,
  kernelSandboxHint,
  pasteChord,
  quitChord,
  selectAllChord,
} from './inspector'
import { DeskStage } from './desk'
import { ensureBox } from './runtime/box'
import { browse, ensureBrowser, focusHostChrome, hostDeskSeams, readHostHandle } from './runtime/chrome'
import { displayForMouth } from './runtime/computer'
import { chatComputerOpenRouter, ensureComputerWorker, liveComputerSeams } from './runtime/computer-worker'
import { setHumanDriving } from './runtime/driving'
import { quitAutomaton } from './runtime/quit'
import { ensureScreen } from './runtime/screen'
import {
  addLiveAgent,
  attachPmJob,
  completeComputer,
  completeJob,
  completeMouth,
  hasUserMessage,
  maybeIntro,
  pendingMouthTurns,
  confirmDeskHandoff,
  confirmFanout,
  dismissDeskHandoff,
  dismissFanout,
  dropLiveAgent,
  dropPendingPath,
  failComputer,
  failJob,
  failMouth,
  noteJobStatus,
  patchLiveAgent,
  queuePaths,
  dispatchableJobs,
  finishSend,
  paintSend,
  resumeComputer,
  runningComputerWorkers,
  runningJobs,
  setActive,
  setDraft,
  stopRun,
  cancelGoal,
  retryGoal,
  waitComputerHost,
  waitComputerOperator,
  waitJobExternal,
  waitJobUser,
  answerWidget,
  dismissWidget,
  fulfillSecretRequest,
  dismissSecretRequest,
  type Session,
} from './session'
import { SisterBlob, framePath, markFor } from './blob'
import { applyChromeToTokens, railDragOrigin, railIsCompact, railWidthFromDrag, readSkin, writeSkin } from './runtime/skin'
import { ConfirmCard, QuestionCard, SecretRequestCard } from './cards'
import { connectorDisplayName } from './runtime/connectors'
import { Settings } from './settings'
import { CHAT_THEME, FIELD_THEME, T } from './tokens'
import { MARK_PATH, PRODUCT } from './brand'
import { Chip, lastItemAt, modelFamily, Pill, railClock, toneFill } from './ui'
import { UpdateModal } from './update-modal'
import { mouthModelFor } from './runtime/plane'

type Pane = 'none' | 'inspector' | 'settings'

export type FeedApi = {
  selectAll: () => void
  copy: () => boolean
}
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
    goals: [],
    pendingFanout: null,
  }
}

function presentOverlayFrame(
  renderer: { commitMutations?: () => void; tick?: () => unknown } | null,
): void {
  renderer?.commitMutations?.()
  if (typeof renderer?.tick === 'function') renderer.tick()
}


function bindNewUserAttachments(store: StaffStore, before: Session, after: Session): void {
  for (const [id, row] of Object.entries(after.threads)) {
    const prev = new Set((before.threads[id]?.items ?? []).map((item) => item.id))
    for (const item of row.items) {
      if (item.kind === 'msg' && item.from === 'user' && !prev.has(item.id) && item.attachmentIds?.length) {
        store.bindAttachments(item.attachmentIds, item.id)
      }
    }
  }
}

function persistIntroIfUserSpoke(session: Session): void {
  for (const id of Object.keys(session.threads)) {
    if (hasUserMessage(session, id)) markIntroPlayedAt(id)
  }
}

function playIntro(session: Session, agentId: string): Session {
  const played = readProfile(agentId)?.introPlayedAt ?? null
  if (hasUserMessage(session, agentId) && !played) markIntroPlayedAt(agentId)
  return maybeIntro(session, agentId, played)
}

export function App({ store: providedStore }: { store?: StaffStore } = {}) {
  const store = useMemo(() => {
    if (providedStore) return providedStore
    adoptMarionetteOpenRouterKey()
    return openStaffStore()
  }, [providedStore])
  const [session, setSession] = useState<Session>(() => {
    const seeded = hydrateSession(store.load() ?? emptySeed())
    return runningTests() ? seeded : playIntro(seeded, seeded.activeAgentId)
  })
  const [pane, setPane] = useState<Pane>('none')
  const [planeTick, setPlaneTick] = useState(0)
  const [chromeTick, setChromeTick] = useState(0)
  void chromeTick
  const [railWidth, setRailWidth] = useState(() => readSkin().railWidth)
  const [railDragging, setRailDragging] = useState(false)
  const [railMenu, setRailMenu] = useState<RailMenuAt | null>(null)
  const [deskControl, setDeskControl] = useState(false)
  const [update, setUpdate] = useState<UpdateOffer | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateNote, setUpdateNote] = useState('')
  const [pendingSend, setPendingSend] = useState<PendingSendView | null>(null)
  const { renderer } = useGpuix()
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
  const overlayBusy = Boolean(
    pendingSend &&
      pendingSend.agentId === session.activeAgentId &&
      !sessionCoversPending(thread?.items ?? [], pendingSend),
  )
  const feedItems = mergePendingFeed(thread?.items ?? [], pendingSend, session.activeAgentId)
  const jobs = runningJobs(session)
  const blocker = oldestWaitingUserGoal(session.goals)
  const profile = active ? readProfile(active.id) : null
  const sandboxHint = active ? kernelSandboxHint(active.id, profile?.kit) : null
  const mouthEpoch = Object.values(session.threads)
    .map((row) => `${row.agentId}:${row.mouth}`)
    .join('|')

  const toggleInspector = () => {
    setPane((current) => (current === 'inspector' ? 'none' : 'inspector'))
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!pendingSend) return
    const row = session.threads[pendingSend.agentId]
    if (row && sessionCoversPending(row.items, pendingSend)) setPendingSend(null)
  }, [session, pendingSend])

  useEffect(() => {
    if (runningTests()) {
      store.save(session)
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      store.save(session)
    }, 0)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [store, session])

  useEffect(() => {
    if (runningTests()) return
    ensureBox()
    ensureScreen(session.activeAgentId)
  }, [])

  useEffect(() => {
    if (runningTests()) return
    let gone = false
    const look = () => {
      const offer = checkForUpdate()
      if (gone || !shouldOfferUpdate(offer, readDismissedSha())) return
      setUpdate(offer)
    }
    const start = setTimeout(look, 800)
    const pulse = setInterval(look, 4 * 60 * 60 * 1000)
    return () => {
      gone = true
      clearTimeout(start)
      clearInterval(pulse)
    }
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
    if (runningTests()) return
    void ensureMouth(session, store, {
      onComplete: (agentId, spoken) => {
        setSession((current) => {
          if (current.threads[agentId]?.mouth === 'intro') markIntroPlayedAt(agentId)
          const next = completeMouth(current, agentId, spoken)
          bindNewUserAttachments(store, current, next)
          persistIntroIfUserSpoke(next)
          return next
        })
      },
      onFail: (agentId, spoken) => {
        setSession((current) => {
          const next = failMouth(current, agentId, spoken)
          bindNewUserAttachments(store, current, next)
          persistIntroIfUserSpoke(next)
          return next
        })
      },
    })
  }, [store, mouthEpoch])

  useEffect(() => {
    if (runningTests()) return
    for (const job of dispatchableJobs(session)) {
      let pmIdentity = job.pmJobId
      void ensureDispatched(
        job,
        {
          onAttached: (pmJobId) => {
            pmIdentity = pmJobId
            setSession((current) => attachPmJob(current, job.id, pmJobId))
          },
          onStatus: (spoken) => {
            setSession((current) => noteJobStatus(current, job.id, spoken))
          },
          onComplete: (spoken) => {
            if (job.kind !== 'box-shell' && job.kind !== 'promote' && job.kind !== 'ship') {
              const taskKey = claimTaskKey({
                ownerAgentId: job.ownerAgentId,
                kind: job.kind,
                goal: job.goal,
              })
              const repo = claimRepoForJob(job)
              if (job.kind === 'analyze' && isLiveAnalyzeGoal(job.goal)) {
                store.staleClaims({ ownerAgentId: job.ownerAgentId, repo, taskKey })
              }
              store.remember({
                ownerAgentId: job.ownerAgentId,
                text: spoken,
                source: 'job',
                jobId: pmIdentity,
                taskKey,
                repo,
                artifactKind: job.kind,
                freshness: 'fresh',
              })
            }
            setSession((current) => {
              const next = completeJob(current, job.id, spoken)
              bindNewUserAttachments(store, current, next)
              persistIntroIfUserSpoke(next)
              return next
            })
          },
          onFail: (spoken) => {
            setSession((current) => {
              const next = failJob(current, job.id, spoken)
              bindNewUserAttachments(store, current, next)
              persistIntroIfUserSpoke(next)
              return next
            })
          },
          onWaitingExternal: () => {
            setSession((current) => waitJobExternal(current, job.id))
          },
          onWaitingUser: (spoken, source) => {
            setSession((current) => waitJobUser(current, job.id, spoken, source))
          },
        },
        session.jobs,
      )
    }
  }, [store, session.jobs.map((job) => `${job.id}:${job.status}`).join('|')])

  useEffect(() => {
    if (runningTests()) return
    for (const worker of runningComputerWorkers(session)) {
      const agent = session.agents.find((row) => row.id === worker.ownerAgentId)
      const keys = listOpenRouterKeys()
      void ensureComputerWorker(
        worker.id,
        {
          agentId: worker.ownerAgentId,
          agentName: agent?.name ?? 'Worker',
          display: worker.display,
          goal: worker.goal,
          kit: kitForAgent(worker.ownerAgentId),
          role: 'worker',
          chat: async (messages) => {
            if (keys.length === 0) return { text: 'Need an OpenRouter key.' }
            return chatComputerOpenRouter(messages, keys[0]!.key, undefined, worker.ownerAgentId)
          },
          seams: {
            ...liveComputerSeams(),
            hostAllowed: worker.hostAllowed === true ? true : undefined,
          },
        },
        {
          onComplete: (spoken, screenshotPath) => {
            setSession((current) => completeComputer(current, worker.id, spoken, screenshotPath))
          },
          onFail: (spoken) => {
            setSession((current) => failComputer(current, worker.id, spoken))
          },
          onOperatorHelp: (instruction) => {
            setSession((current) => waitComputerOperator(current, worker.id, instruction))
          },
          onHostApproval: (prompt, action) => {
            setSession((current) => waitComputerHost(current, worker.id, prompt, action))
          },
        },
      )
    }
  }, [
    session.computerWorkers
      ?.map((row) => `${row.id}:${row.status}:${row.hostAllowed === true ? '1' : '0'}`)
      .join('|') ?? '',
  ])

  const onSend = () => {
    if (!thread || !active) return
    const carry = {
      paths: [] as string[],
      draft: '',
      agentId: session.activeAgentId,
      ids: [] as string[],
    }
    const capture = (current: Session) => {
      const row = current.threads[current.activeAgentId]
      if (!row) return null
      carry.paths = [...(row.pendingPaths ?? [])]
      carry.draft = row.draft
      carry.agentId = current.activeAgentId
      carry.ids = carry.paths.map(() => nextId('att'))
      return row
    }
    const finish = () => {
      const bound: string[] = []
      for (let i = 0; i < carry.paths.length; i += 1) {
        try {
          const attachment = ingestPath(carry.agentId, carry.paths[i]!, carry.ids[i]!)
          store.recordAttachment(attachment)
          bound.push(attachment.id)
        } catch {
          /* missing path stays off the bubble */
        }
      }
      const created =
        kitForAgent(carry.agentId) === 'coordinator'
          ? createAgentNames(carry.draft).map((name) => createAgent({ name, kit: 'code' as const }))
          : []
      setSession((current) => {
        let next = current
        for (const row of created) next = addLiveAgent(next, row.agent, false)
        if (kitForAgent(carry.agentId) === 'coordinator') {
          const trimmed = carry.draft.trim()
          for (const agent of applyHomeBinds(bindHomes(trimmed, visibleAgents(next.agents)))) {
            next = patchLiveAgent(next, agent)
          }
          for (const agent of next.agents) {
            const profile = readProfile(agent.id)
            if (!profile || profile.name === agent.name) continue
            writeProfile({ ...profile, name: agent.name, namedBy: 'user' })
          }
        }
        if (bound.length > 0) {
          const row = next.threads[carry.agentId]
          const last = [...(row?.items ?? [])]
            .reverse()
            .find((item) => item.kind === 'msg' && item.from === 'user')
          if (last?.kind === 'msg') store.bindAttachments(bound, last.id)
        }
        persistIntroIfUserSpoke(next)
        return { ...next }
      })
    }
    if (runningTests()) {
      setSession((current) => {
        const row = capture(current)
        if (!row) return current
        for (let i = 0; i < carry.paths.length; i += 1) {
          try {
            const attachment = ingestPath(carry.agentId, carry.paths[i]!, carry.ids[i]!)
            store.recordAttachment(attachment)
          } catch {
            /* missing path stays off the bubble */
          }
        }
        const next = finishSend(paintSend(current, row.draft, carry.ids))
        const last = [...(next.threads[carry.agentId]?.items ?? [])]
          .reverse()
          .find((item) => item.kind === 'msg' && item.from === 'user')
        if (last?.kind === 'msg' && carry.ids.length > 0) store.bindAttachments(carry.ids, last.id)
        persistIntroIfUserSpoke(next)
        return next
      })
      return
    }
    if (shouldQueueSteer(thread.mouth, thread.computerBusy === true)) {
      setSession((current) => {
        const row = capture(current)
        if (!row) return current
        return paintSend(current, row.draft, carry.ids)
      })
      setTimeout(finish, 0)
      return
    }
    const text = thread.draft.trim()
    if (!text && (thread.pendingPaths ?? []).length === 0) return
    carry.paths = [...(thread.pendingPaths ?? [])]
    carry.draft = thread.draft
    carry.agentId = session.activeAgentId
    carry.ids = carry.paths.map(() => nextId('att'))
    const overlay = createPendingSendView(text, session.agents, carry.agentId)
    flushSync(() => {
      setPendingSend(overlay)
    })
    presentOverlayFrame(renderer)
    setTimeout(() => {
      setSession((current) =>
        finishSend(
          paintSend(current, carry.draft, carry.ids, {
            userItemId: overlay.userItemId,
            ackItemId: overlay.ack ? overlay.ackItemId : undefined,
          }),
        ),
      )
      finish()
    }, 0)
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
  const feedApi = useRef<FeedApi | null>(null)
  const composerFocused = useRef(false)
  const draftRef = useRef(thread?.draft ?? '')
  draftRef.current = thread?.draft ?? ''

  const copyFeedIfIdle = () => {
    if (composerFocused.current && draftRef.current.length > 0) return
    feedApi.current?.copy()
  }
  const cutComposerIfFocused = () => {
    if (!composerFocused.current) return
    const draft = draftRef.current
    if (!draft) return
    if (!copyTextToClipboard(draft)) return
    setSession((current) => setDraft(current, ''))
  }

  useEffect(() => {
    if (runningTests()) return
    const stopPaste = watchPasteHotkey(() => enqueueClipboardRef.current())
    const stopCopy = watchCopyHotkey(() => copyFeedIfIdle())
    const stopSelectAll = watchSelectAllHotkey(() => feedApi.current?.selectAll())
    const stopCut = watchCutHotkey(() => cutComposerIfFocused())
    const stopQuit = watchQuitHotkey(() => quitAutomaton())
    return () => {
      stopPaste()
      stopCopy()
      stopSelectAll()
      stopCut()
      stopQuit()
    }
  }, [])

  const onCreateAgent = () => {
    setRailMenu(null)
    const created = createAgent()
    setSession((current) =>
      addLiveAgent(
        current,
        created.agent,
        true,
        runningTests() ? undefined : created.profile.introPlayedAt ?? null,
      ),
    )
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
        flexDirection: 'column',
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
        if (selectAllChord(event)) feedApi.current?.selectAll()
        if (copyChord(event)) copyFeedIfIdle()
        if (cutChord(event)) cutComposerIfFocused()
        if (quitChord(event)) quitAutomaton()
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
          width: '100%',
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
          planeTick={planeTick}
          onSelect={(id) => {
            if (skipSelect.current) {
              skipSelect.current = false
              return
            }
            setRailMenu(null)
            setSession((current) => (runningTests() ? setActive(current, id) : playIntro(setActive(current, id), id)))
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
          backgroundColor: T.clear,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexGrow: 1,
            minHeight: 0,
            minWidth: 0,
            backgroundColor: T.clear,
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
              ref={feedApi}
              key={session.activeAgentId}
              items={feedItems}
              mouth={thread?.mouth ?? 'idle'}
              agents={session.agents}
              dockPad={0}
              storeAnswer={(userItemId) => isStoreAnswer(store, userItemId)}
              attachmentsFor={(ids) =>
                ids.flatMap((id) => store.listAttachments().filter((row) => row.id === id))
              }
              onAnswerWidget={(id, answer) => setSession((current) => answerWidget(current, id, answer))}
              onDismissWidget={(id) => setSession((current) => dismissWidget(current, id))}
              onSaveSecret={(id, value) => setSession((current) => fulfillSecretRequest(current, id, value))}
              onDismissSecret={(id) => setSession((current) => dismissSecretRequest(current, id))}
            />
            <div
              testId="dock"
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                backgroundColor: T.clear,
              }}
            >
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
                    if (agentId) {
                      try {
                        setHumanDriving(displayForMouth(agentId), true)
                      } catch {
                        /* fail open */
                      }
                      if (!runningTests()) {
                        void ensureBrowser(agentId, undefined, {
                          ...hostDeskSeams(agentId),
                          url: session.deskHandoff?.url,
                        })
                        const hosted = readHostHandle(agentId)
                        if (hosted) focusHostChrome(hosted.pid)
                      }
                    }
                  }}
                  onDismiss={() => setSession((current) => dismissDeskHandoff(current))}
                />
              ) : null}
              {blocker ? (
                <GoalBlockerPanel
                  goal={blocker}
                  agents={session.agents}
                  onRetry={() => setSession((current) => retryGoal(current, blocker.id))}
                  onCancel={() => {
                    const jobId = blocker.blocker?.jobId
                    if (jobId) abandonJob(jobId)
                    setSession((current) => cancelGoal(current, blocker.id))
                  }}
                />
              ) : null}
              <Composer
                value={overlayBusy ? '' : (thread?.draft ?? '')}
                pendingPaths={overlayBusy ? [] : (thread?.pendingPaths ?? [])}
                locked={!thread || overlayBusy || composerEnterBusy(thread.mouth, thread.computerBusy === true)}
                queueing={Boolean(thread && shouldQueueSteer(thread.mouth, thread.computerBusy === true))}
                queued={thread?.steerQueue.length ?? 0}
                stopping={Boolean(
                  overlayBusy ||
                    (thread &&
                      (thread.mouth !== 'idle' ||
                        thread.computerBusy === true ||
                        jobs.length > 0)),
                )}
                onChange={(value) => setSession((current) => setDraft(current, value))}
                onAttach={onAttach}
                onPaste={enqueueClipboard}
                onFocus={() => {
                  composerFocused.current = true
                }}
                onBlur={() => {
                  composerFocused.current = false
                }}
                onDropPending={(path) => setSession((current) => dropPendingPath(current, path))}
                onSend={onSend}
                onStop={() => {
                  const agentId = session.activeAgentId
                  dropMouthStarts(
                    pendingMouthTurns(session)
                      .filter((turn) => turn.agentId === agentId)
                      .map((turn) => turn.itemId),
                  )
                  for (const job of runningJobs(session)) abandonJob(job.id)
                  setSession((current) => {
                    const next = stopRun(current, agentId)
                    bindNewUserAttachments(store, current, next)
                    persistIntroIfUserSpoke(next)
                    return next
                  })
                }}
              />
            </div>
          </div>
          <SlidePane testId="inspector-pane" open={pane === 'inspector' && Boolean(active)} width={T.inspector.width}>
            {pane === 'inspector' && active ? (
              <Inspector
                agent={active}
                profile={profile}
                claims={store.listClaims()}
                sandboxHint={sandboxHint}
                onClose={() => setPane('none')}
                onPatch={onPatchProfile}
                controlling={deskControl}
                onTakeControl={() => {
                  setDeskControl((on) => {
                    const next = !on
                    try {
                      setHumanDriving(displayForMouth(active.id), next)
                    } catch {
                      /* fail open: a harness hiccup must not brick the computer */
                    }
                    if (next && !runningTests()) {
                      void ensureBrowser(active.id, undefined, hostDeskSeams(active.id))
                      const hosted = readHostHandle(active.id)
                      if (hosted) focusHostChrome(hosted.pid)
                    }
                    if (!next) {
                      setSession((current) => resumeComputer(current, active.id))
                    }
                    return next
                  })
                }}
              />
            ) : null}
          </SlidePane>
          <SlidePane testId="settings-pane" open={pane === 'settings'} width={T.inspector.settings}>
            {pane === 'settings' ? (
              <Settings
                metrics={store.metrics()}
                agents={visibleAgents(session.agents)}
                onClose={() => setPane('none')}
                onPlaneChange={() => setPlaneTick((n) => n + 1)}
                onSkinChange={() => {
                  applyChromeToTokens(readSkin())
                  setChromeTick((n) => n + 1)
                }}
              />
            ) : null}
          </SlidePane>
        </div>
      </div>
      </div>
      {update ? (
        <UpdateModal
          dirty={update.dirty}
          busy={updateBusy}
          note={updateNote}
          onUpdate={() => {
            if (update.dirty || updateBusy) return
            setUpdateBusy(true)
            setUpdateNote('')
            const result = applyUpdate()
            if (result.ok) {
              relaunchAutomaton()
              return
            }
            setUpdateNote(result.spoken)
            setUpdateBusy(false)
          }}
          onLater={() => {
            dismissUpdate(update.latest)
            setUpdate(null)
            setUpdateNote('')
          }}
        />
      ) : null}
      {deskControl && active ? (
        <DeskStage
          agentId={active.id}
          name={active.name}
          left={railWidth + T.layout.railHandle}
          open={deskControl}
          onRelease={() => {
            setDeskControl(false)
            try {
              setHumanDriving(displayForMouth(active.id), false)
            } catch {
              /* fail open */
            }
            setSession((current) => resumeComputer(current, active.id))
          }}
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
        width: T.layout.railHandle + T.stroke.hairline,
        height: '100%',
        flexShrink: 0,
        backgroundColor: T.clear,
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
        borderRadius: T.radius.md,
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
  const size = T.size.badge
  const spoke = T.space.xxs
  const mid = (size - spoke) / 2
  const hub = 6
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
  planeTick = 0,
  onSelect,
  onCreate,
  onMenu,
  onSettings,
}: {
  session: Session
  width: number
  planeTick?: number
  onSelect: (id: string) => void
  onCreate: () => void
  onMenu: (id: string, event: { x?: number; y?: number }) => void
  onSettings: () => void
}) {
  void planeTick
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
      <div style={{ height: T.space.sm, flexShrink: 0 }} />
      {agents.map((agent, index) => {
        const row = session.threads[agent.id]
        const selected = agent.id === session.activeAgentId
        const mouth = row?.mouth ?? 'idle'
        const mouthBusy = isMouthBusy(mouth)
        const alive = mouthBusy || mouth === 'working' || row?.computerBusy === true
        const pin = mouthModelFor(agent.id)
        const family = modelFamily(pin)
        const at = row ? lastItemAt(row.items) : null
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
              paddingTop: compact ? T.space.sm : T.space.md,
              paddingBottom: compact ? T.space.sm : T.space.md,
              marginLeft: rowMargin,
              marginRight: rowMargin,
              marginBottom: T.space.xs,
              ...HIT,
              backgroundColor: T.clear,
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
            <SisterBlob
              agent={agent}
              selected={selected}
              unread={0}
              mouthBusy={mouthBusy}
              alive={alive}
              index={index}
              onSelect={() => onSelect(agent.id)}
              onMenu={(event) => onMenu(agent.id, event)}
            />
            {compact ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: T.space.xxs }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: T.space.sm,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: T.type.md,
                      color: T.text,
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      flexGrow: 1,
                      minWidth: 0,
                    }}
                  >
                    {agent.name}
                  </div>
                  <Pill testId={`rail-model-${agent.id}`} label={family} />
                  {at != null ? (
                    <div style={{ fontSize: T.type.xs, color: T.ghost, flexShrink: 0 }}>{railClock(at)}</div>
                  ) : null}
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
          borderRadius: T.radius.md,
          minHeight: T.blob.slot,
          ...HIT,
          backgroundColor: T.clear,
          hover: { backgroundColor: T.raised },
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
          borderRadius: T.radius.md,
          minHeight: T.blob.slot,
          ...HIT,
          backgroundColor: T.clear,
          hover: { backgroundColor: T.raised },
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
        backgroundColor: T.clear,
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
      <div testId="titlebar-name" style={{ fontSize: T.type.sm, color: T.secondary }}>
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
  width: paneWidth = T.inspector.width,
  children,
}: {
  open: boolean
  testId: string
  width?: number
  children: React.ReactNode
}) {
  const width = open ? paneWidth : 0
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
        <div style={{ width: paneWidth, height: '100%', minHeight: 0 }}>{children}</div>
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
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: T.space.xs,
        paddingTop: T.space.xs,
        paddingBottom: T.space.xs,
      }}
    >
      {existsSync(rest) ? (
        <img
          src={rest}
          objectFit="contain"
          alt=""
          style={{ width: T.size.badge, height: T.size.badge }}
        />
      ) : null}
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{label}</div>
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
        paddingTop: T.space.sm,
        paddingBottom: T.space.sm,
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
        backgroundColor: T.clear,
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
    if (item.kind === 'relay' || item.kind === 'msg' || item.kind === 'widget' || item.kind === 'secret-request') {
      count += 1
    }
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
        lineHeight: T.line.lg,
        color: T.ghost,
      }}
    >
      {thinkingDots(step)}
    </div>
  )
}

export const Feed = forwardRef<FeedApi, {
  items: FeedItem[]
  agents: Agent[]
  storeAnswer: (userItemId: string) => boolean
  attachmentsFor?: (ids: string[]) => { id: string; path: string; kind: 'image' | 'file' }[]
  dockPad?: number
  mouth?: MouthState
  onAnswerWidget?: (id: string, answer: WidgetAnswer) => void
  onDismissWidget?: (id: string) => void
  onSaveSecret?: (id: string, value: string) => void
  onDismissSecret?: (id: string) => void
}>(function Feed(
  {
    items,
    agents,
    storeAnswer,
    attachmentsFor,
    dockPad = 0,
    mouth = 'idle',
    onAnswerWidget,
    onDismissWidget,
    onSaveSecret,
    onDismissSecret,
  },
  api,
) {
  const listRef = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const thinking = feedThinking(mouth, items)
  const pin = feedTailKey(items, dockPad, thinking)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const lastClicked = useRef<string | null>(null)
  const dragFrom = useRef<string | null>(null)
  const dragging = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashCopied = (id: string) => {
    setCopiedId(id)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    if (runningTests()) return
    copyTimer.current = setTimeout(() => setCopiedId(null), T.feed.copyFlashMs)
  }
  const copyBubble = (id: string, text: string) => {
    if (!copyTextToClipboard(text)) return
    lastClicked.current = id
    flashCopied(id)
  }
  const copySelection = () => {
    const ok = copyFeedSelection(items, selectedIds, lastClicked.current)
    if (!ok) return false
    const mark = selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : lastClicked.current
    if (mark) flashCopied(mark)
    return true
  }
  const selectAll = () => {
    setSelectedIds(new Set(feedMsgIds(items)))
  }
  useImperativeHandle(api, () => ({ selectAll, copy: copySelection }), [items, selectedIds])
  useEffect(() => {
    pinFeedTail(renderer, listRef.current, items, thinking)
  }, [pin, items, renderer, thinking])
  return (
    <virtual-list
      ref={listRef}
      testId="feed"
      alignment="bottom"
      followTail
      estimatedItemHeight={T.line.lg * 3}
      style={feedScrollStyle}
      onMouseUp={() => {
        dragging.current = false
      }}
      onKeyDown={(event: { key?: string; modifiers?: { cmd?: boolean; shift?: boolean; alt?: boolean } }) => {
        if (selectAllChord(event)) selectAll()
        if (copyChord(event)) copySelection()
      }}
    >
      {items.length === 0 ? (
        <div
          testId="feed-empty"
          style={{
            ...feedLane,
            paddingTop: T.space.hero,
            paddingBottom: T.space.hero,
            display: 'flex',
            flexDirection: 'column',
            gap: T.space.sm,
          }}
        >
          <div style={{ fontSize: T.type.lg, lineHeight: T.line.lg, color: T.secondary }}>
            Start shipping. No strings attached.
          </div>
          <div style={{ fontSize: T.type.sm, color: T.ghost }}>Pick a mouth on the rail. Words go here.</div>
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
        if (item.kind === 'widget') {
          return (
            <div key={item.id} style={{ width: '100%', paddingTop: T.feed.turn }}>
              <QuestionCard
                testId={`widget-${item.id}`}
                widget={item.widget}
                status={item.status}
                answer={item.answer}
                onAnswer={(answer) => onAnswerWidget?.(item.id, answer)}
                onDismiss={() => onDismissWidget?.(item.id)}
              />
            </div>
          )
        }
        if (item.kind === 'secret-request') {
          return (
            <div key={item.id} style={{ width: '100%', paddingTop: T.feed.turn }}>
              <SecretRequestCard
                testId={`secret-request-${item.id}`}
                connectorName={connectorDisplayName(item.connectorId)}
                status={item.status}
                configured={item.configured}
                onSave={(value) => onSaveSecret?.(item.id, value)}
                onDismiss={() => onDismissSecret?.(item.id)}
              />
            </div>
          )
        }
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
            <div
              testId={mine ? 'bubble-mine' : 'bubble-theirs'}
              style={{
                maxWidth: T.feed.max,
                backgroundColor: selectedIds.has(item.id) ? (mine ? T.raised : T.selected) : mine ? T.selected : T.composer,
                borderRadius: T.radius.xl,
                borderWidth: selectedIds.has(item.id) || !mine ? T.stroke.hairline : T.stroke.none,
                borderColor: selectedIds.has(item.id) ? T.borderStrong : mine ? T.clear : T.border,
                paddingTop: T.feed.padY,
                paddingBottom: T.feed.padY,
                paddingLeft: T.feed.padX,
                paddingRight: T.feed.padX,
                fontSize: T.type.md,
                lineHeight: T.line.lg,
                minHeight: T.line.lg,
                color: T.text,
                userSelect: 'none' as const,
              }}
              onKeyDown={(event: { key?: string; modifiers?: { cmd?: boolean; shift?: boolean; alt?: boolean } }) => {
                if (selectAllChord(event)) selectAll()
                if (copyChord(event)) copySelection()
              }}
              onMouseDown={(event) => {
                if (event.isRightClick || event.button === 2) {
                  copyBubble(item.id, item.text)
                  return
                }
                const anchor = lastClicked.current
                lastClicked.current = item.id
                if (event.modifiers?.shift && anchor) {
                  dragging.current = false
                  dragFrom.current = anchor
                  setSelectedIds(new Set(selectFeedRange(feedMsgIds(items), anchor, item.id)))
                  return
                }
                dragging.current = true
                dragFrom.current = item.id
                setSelectedIds(new Set([item.id]))
              }}
              onMouseEnter={() => {
                if (!dragging.current || !dragFrom.current) return
                setSelectedIds(new Set(selectFeedRange(feedMsgIds(items), dragFrom.current, item.id)))
              }}
              onMouseMove={() => {
                if (!dragging.current || !dragFrom.current) return
                setSelectedIds(new Set(selectFeedRange(feedMsgIds(items), dragFrom.current, item.id)))
              }}
              onMouseUp={() => {
                dragging.current = false
              }}
            >
              <div testId={`msg-${item.id}`} style={{ width: T.stroke.hairline, height: T.stroke.hairline }} />
              {selectedIds.has(item.id) ? (
                <div testId={`sel-${item.id}`} style={{ width: T.stroke.hairline, height: T.stroke.hairline }} />
              ) : null}
              {mine ? item.text : <markdown source={item.text} theme={CHAT_THEME} />}
            </div>
            {mine ? <FeedGutterEnd pad={T.feed.padX} /> : null}
            </div>
            ) : null}
            {copiedId === item.id ? (
              <div
                testId="copied-mark"
                style={{
                  fontSize: T.type.xs,
                  color: T.tertiary,
                  paddingLeft: mine ? 0 : T.space.md,
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                }}
              >
                Copied
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
})

function GoalBlockerPanel({
  goal,
  agents,
  onRetry,
  onCancel,
}: {
  goal: GoalRun
  agents: Agent[]
  onRetry: () => void
  onCancel: () => void
}) {
  const criterion = goal.criteria.find((row) => row.id === goal.blocker?.criterionId)
  const owner = agents.find((agent) => agent.id === goal.ownerAgentId)
  const context = [owner?.name, criterion?.label, goal.text].filter(Boolean).join(' · ')
  return (
    <div
      testId="goal-blocker"
      style={{
        marginLeft: T.space.xl,
        marginRight: T.space.xl,
        marginBottom: T.space.sm,
        padding: T.space.lg,
        borderRadius: T.radius.lg,
        backgroundColor: T.raised,
        borderWidth: T.stroke.hairline,
        borderColor: T.border,
        display: 'flex',
        flexDirection: 'column',
        gap: T.space.md,
      }}
    >
      <div style={{ fontSize: T.type.xs, color: T.secondary }}>Waiting on you</div>
      <div style={{ fontSize: T.type.sm, color: T.text }}>{context}</div>
      <div style={{ fontSize: T.type.sm, color: T.secondary }}>{goal.blocker?.reason}</div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: T.space.sm }}>
        <Chip testId="goal-blocker-retry" tone="action" onClick={onRetry}>
          Retry
        </Chip>
        <Chip testId="goal-blocker-cancel" tone="ghost" onClick={onCancel}>
          Cancel goal
        </Chip>
      </div>
    </div>
  )
}

export function Composer({
  value,
  pendingPaths,
  locked,
  queueing = false,
  queued = 0,
  stopping = false,
  onChange,
  onAttach,
  onPaste,
  onFocus,
  onBlur,
  onDropPending,
  onSend,
  onStop,
}: {
  value: string
  pendingPaths: string[]
  locked: boolean
  queueing?: boolean
  queued?: number
  stopping?: boolean
  onChange: (value: string) => void
  onAttach: () => void
  onPaste: () => void
  onFocus?: () => void
  onBlur?: () => void
  onDropPending: (path: string) => void
  onSend: () => void
  onStop?: () => void
}) {
  const ready = (value.trim().length > 0 || pendingPaths.length > 0) && !locked
  const steer =
    queued > 0 ? `${queued} queued` : queueing ? 'Send queues until this turn ends' : null
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
          borderRadius: T.radius.xl,
          borderWidth: T.stroke.hairline,
          borderColor: T.border,
          paddingTop: T.space.md,
          paddingBottom: T.space.md,
          position: 'relative',
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
        {value.length === 0 && pendingPaths.length === 0 ? (
          <div
            testId="composer-placeholder"
            style={{
              position: 'absolute',
              left: T.space.md,
              top: T.space.md,
              color: T.text,
              fontSize: T.type.md,
              lineHeight: T.line.md,
              pointerEvents: 'none',
            }}
          >
            Message this automaton
          </div>
        ) : null}
        <textarea
          testId="composer"
          value={value}
          placeholder=""
          minRows={1}
          maxRows={4}
          autoFocus
          theme={FIELD_THEME}
          style={{
            width: '100%',
            minWidth: 0,
            fontSize: T.type.md,
            lineHeight: T.line.md,
            color: T.text,
            backgroundColor: T.clear,
            borderWidth: 0,
            borderColor: T.clear,
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingBottom: T.space.xs,
          }}
          onChange={(event) => onChange(event.value ?? '')}
          onFocus={onFocus}
          onBlur={onBlur}
          onSubmit={() => {
            if (ready) onSend()
          }}
          onKeyDown={(event) => {
            if (pasteChord(event)) onPaste()
            if (copyChord(event) && !value) return
            if (cutChord(event) && value) {
              if (copyTextToClipboard(value)) onChange('')
              return
            }
            if (quitChord(event)) quitAutomaton()
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
              borderRadius: T.radius.md,
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
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
            {stopping ? (
              <Chip testId="composer-stop" tone="ghost" onClick={() => onStop?.()}>
                Stop
              </Chip>
            ) : null}
            <div
              testId="send"
              style={{
                paddingLeft: T.space.lg,
                paddingRight: T.space.lg,
                paddingTop: T.space.control,
                paddingBottom: T.space.control,
                borderRadius: T.radius.md,
                ...toneFill('action', ready),
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
        {steer ? (
          <div
            testId="steer-hint"
            style={{
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.sm,
              fontSize: T.type.xs,
              color: T.ghost,
            }}
          >
            {steer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
