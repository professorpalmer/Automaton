import React from 'react'
import { copyChord, cutChord, pasteChord, quitChord } from '../inspector'
import { copyTextToClipboard } from '../runtime/clipboard'
import { quitAutomaton } from '../runtime/quit'
import { toFieldTheme, useTokens } from '../theme'
import { Chip, toneFill } from '../ui'

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
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
  const T = useTokens()
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
          borderRadius: T.radius.surface,
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
                    borderRadius: T.radius.control,
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
          theme={toFieldTheme(T)}
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
              borderRadius: T.radius.button,
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
                borderRadius: T.radius.button,
                ...toneFill('action', ready, T),
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
