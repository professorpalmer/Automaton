import React, { useEffect, useRef, useState } from 'react'
import { useGpuix } from '@gpuix/react'
import { BOX_DISPLAY_H, BOX_DISPLAY_W } from './runtime/computer'
import { ensureBrowser } from './runtime/chrome'
import { captureDesk, captureDeskAsync, clickDesk, keyDesk, mapViewToDisplay, wheelDesk, xdoKey } from './runtime/desk'
import { desktopPreview } from './runtime/desktop'
import { runningTests } from './runtime/test-env'
import { T } from './tokens'

function quitChord(event: {
  key?: string
  modifiers?: { cmd?: boolean; shift?: boolean; alt?: boolean }
}): boolean {
  const key = event.key?.toLowerCase()
  return Boolean(event.modifiers?.cmd) && !event.modifiers?.shift && !event.modifiers?.alt && (key === 'q' || key === 'w')
}

function useDeskFrame(agentId: string, live: boolean) {
  const preview = desktopPreview(agentId)
  const [screen, setScreen] = useState<string | null>(preview.screen)
  const pressed = useRef(false)
  const inflight = useRef(false)
  const recapture = () => {
    if (pressed.current || inflight.current) return
    if (runningTests()) {
      setScreen(captureDesk(agentId))
      return
    }
    inflight.current = true
    captureDeskAsync(agentId, (path) => {
      inflight.current = false
      if (path) setScreen(path)
    })
  }
  useEffect(() => {
    recapture()
  }, [agentId])
  useEffect(() => {
    if (!live || runningTests()) return
    const tick = setInterval(() => recapture(), T.desk.pollMs)
    return () => clearInterval(tick)
  }, [agentId, live])
  return { screen, recapture, pressed }
}

export function DeskStage({
  agentId,
  name,
  left,
  open = true,
  onRelease,
}: {
  agentId: string
  name: string
  left: number
  open?: boolean
  onRelease: () => void
}) {
  const { renderer } = useGpuix()
  const viewRef = useRef<{ id: number } | null>(null)
  const armed = useRef(false)
  const { screen, recapture, pressed } = useDeskFrame(agentId, true)
  useEffect(() => {
    if (runningTests()) return
    void ensureBrowser(agentId)
  }, [agentId])
  const hitView = (event: { x?: number; y?: number }) => {
    const id = viewRef.current?.id
    if (typeof id !== 'number' || typeof event.x !== 'number' || typeof event.y !== 'number') return null
    const box = renderer.getElementBounds?.(id)
    if (!box || box.length < 4) return null
    return mapViewToDisplay(
      { x: box[0], y: box[1], width: box[2], height: box[3] },
      { x: event.x, y: event.y },
    )
  }
  const focusView = () => {
    const id = viewRef.current?.id
    if (typeof id === 'number') renderer.focusElement?.(id)
  }
  const sendClick = (event: { x?: number; y?: number; button?: number; isRightClick?: boolean }) => {
    focusView()
    if (event.isRightClick || event.button === 2) return
    const hit = hitView(event)
    if (!hit) return
    clickDesk(agentId, hit, event.button)
    recapture()
  }
  const onDeskMouseDown = (event: { x?: number; y?: number; button?: number; isRightClick?: boolean }) => {
    pressed.current = true
    armed.current = true
    sendClick(event)
  }
  const onDeskClick = (event: { x?: number; y?: number; button?: number; isRightClick?: boolean }) => {
    if (armed.current) {
      armed.current = false
      return
    }
    sendClick(event)
  }
  const onDeskMouseUp = () => {
    armed.current = false
    pressed.current = false
    recapture()
  }
  const onDeskKey = (event: {
    key?: string
    keyChar?: string
    modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
  }) => {
    if (quitChord(event)) return
    const key = xdoKey(event)
    if (key) keyDesk(agentId, key)
  }
  const onDeskScroll = (event: { deltaY?: number }) => {
    const dy = event.deltaY ?? 0
    if (!dy) return
    wheelDesk(
      agentId,
      {
        x: Math.round(BOX_DISPLAY_W / 2),
        y: Math.round(BOX_DISPLAY_H / 2),
      },
      dy,
    )
  }
  if (!open) return null
  return (
    <div
      testId="desk-stage"
      style={{
        position: 'absolute',
        left,
        top: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: T.canvas,
        pointerEvents: 'auto',
        paddingLeft: T.space.md,
        paddingRight: T.space.md,
        paddingTop: T.space.sm,
        paddingBottom: T.space.md,
        gap: T.space.sm,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: T.type.sm, color: T.secondary }}>{`${name}'s screen`}</div>
        <div
          testId="desk-release"
          style={{
            paddingLeft: T.space.sm,
            paddingRight: T.space.sm,
            paddingTop: T.space.xxs,
            paddingBottom: T.space.xxs,
            borderRadius: T.radius.sm,
            backgroundColor: T.inverse,
            color: T.onInverse,
            fontSize: T.type.xs,
            pointerEvents: 'auto',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onMouseDown={(event) => {
            if (event.isRightClick || event.button === 2) return
            onRelease()
          }}
        >
          Release
        </div>
      </div>
      <div
        ref={viewRef}
        testId="desk-stage-view"
        tabIndex={0}
        autoFocus
        style={{
          position: 'relative',
          flexGrow: 1,
          minHeight: T.desk.stageMinH,
          backgroundColor: T.raised,
          borderRadius: T.radius.sm,
          overflow: 'hidden',
          cursor: 'crosshair',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
        onMouseDown={onDeskMouseDown}
        onMouseUp={onDeskMouseUp}
        onMouseLeave={onDeskMouseUp}
        onClick={onDeskClick}
        onKeyDown={onDeskKey}
        onScroll={onDeskScroll}
      >
        {screen ? (
          <img
            src={screen}
            objectFit="contain"
            alt=""
            style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: T.type.sm,
              color: T.tertiary,
              pointerEvents: 'none',
            }}
          >
            Starting the screen
          </div>
        )}
      </div>
    </div>
  )
}
