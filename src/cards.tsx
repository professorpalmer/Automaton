import React, { useState } from 'react'
import type { QuestionWidget, WidgetAnswer, WidgetOption } from './domain'
import { widgetOptionValue } from './domain'
import { CHAT_THEME, T } from './tokens'

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

const CARD_STYLE = {
  marginLeft: T.space.xl,
  marginRight: T.space.xl,
  marginBottom: T.space.sm,
  padding: T.space.md,
  borderRadius: T.radius.md,
  backgroundColor: T.raised,
  borderWidth: T.stroke.hairline,
  borderColor: T.border,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: T.space.sm,
}

const FIELD_STYLE = {
  width: '100%',
  fontSize: T.type.sm,
  color: T.text,
  backgroundColor: T.composer,
  borderWidth: T.stroke.hairline,
  borderColor: T.border,
  borderRadius: T.radius.sm,
  paddingLeft: T.space.sm,
  paddingRight: T.space.sm,
  paddingTop: T.space.xs,
  paddingBottom: T.space.xs,
}

function optionFill(style: WidgetOption['style'], selected: boolean): { backgroundColor: string; color: string } {
  if (style === 'danger') return { backgroundColor: T.danger, color: T.inverse }
  if (style === 'primary' || selected) return { backgroundColor: T.inverse, color: T.onInverse }
  return { backgroundColor: T.raised, color: T.text }
}

export function ConfirmCard({
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
    <div testId={testId} style={CARD_STYLE}>
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
            ...HIT,
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

export function QuestionCard({
  testId,
  widget,
  status = 'open',
  answer,
  onAnswer,
  onDismiss,
}: {
  testId?: string
  widget: QuestionWidget
  status?: 'open' | 'answered' | 'dismissed'
  answer?: WidgetAnswer
  onAnswer?: (answer: WidgetAnswer) => void
  onDismiss?: () => void
}) {
  const open = status === 'open'
  const [picked, setPicked] = useState<string[]>(answer?.values ?? [])
  const [custom, setCustom] = useState(answer?.custom ?? '')
  const submit = (values: string[], customText?: string) => {
    if (!open) return
    const next: WidgetAnswer = { values }
    const trimmed = customText?.trim()
    if (trimmed) next.custom = trimmed
    onAnswer?.(next)
  }
  const toggle = (value: string) => {
    if (!open) return
    if (widget.multiSelect) {
      setPicked((current) => (current.includes(value) ? current.filter((row) => row !== value) : [...current, value]))
      return
    }
    submit([value])
  }
  return (
    <div testId={testId ?? 'widget'} style={CARD_STYLE}>
      <div testId="widget-prompt" style={{ fontSize: T.type.sm, color: T.text }}>
        {widget.prompt}
      </div>
      {widget.helpText ? (
        <div testId="widget-help" style={{ fontSize: T.type.xs, color: T.tertiary }}>
          {widget.helpText}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm }}>
        {widget.options.map((option, index) => {
          const value = widgetOptionValue(option)
          const selected = picked.includes(value) || Boolean(answer?.values.includes(value))
          const fill = optionFill(option.style, selected)
          return (
            <div
              key={`${value}-${index}`}
              testId={`widget-option-${index}`}
              style={{
                paddingLeft: T.space.md,
                paddingRight: T.space.md,
                paddingTop: T.space.xs,
                paddingBottom: T.space.xs,
                borderRadius: T.radius.sm,
                fontSize: T.type.sm,
                ...fill,
                ...(open ? HIT : { opacity: 0.7 }),
              }}
              onClick={() => toggle(value)}
            >
              {option.label}
            </div>
          )
        })}
      </div>
      {widget.allowCustom && open ? (
        <textarea
          testId="widget-custom"
          value={custom}
          placeholder="Or type your own"
          minRows={1}
          maxRows={3}
          theme={CHAT_THEME}
          style={FIELD_STYLE}
          onChange={(event) => setCustom(event.value ?? '')}
        />
      ) : null}
      {open && (widget.multiSelect || widget.allowCustom) ? (
        <div
          testId="widget-done"
          style={{
            alignSelf: 'flex-start',
            paddingLeft: T.space.md,
            paddingRight: T.space.md,
            paddingTop: T.space.xs,
            paddingBottom: T.space.xs,
            borderRadius: T.radius.sm,
            backgroundColor: T.inverse,
            color: T.onInverse,
            fontSize: T.type.sm,
            ...HIT,
          }}
          onClick={() => submit(picked, custom)}
        >
          Done
        </div>
      ) : null}
      {open && onDismiss ? (
        <div
          testId="widget-dismiss"
          style={{
            alignSelf: 'flex-start',
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
      ) : null}
    </div>
  )
}

export function SecretRequestCard({
  testId,
  connectorName,
  status = 'open',
  configured,
  onSave,
  onDismiss,
}: {
  testId?: string
  connectorName: string
  status?: 'open' | 'saved' | 'dismissed'
  configured?: boolean
  onSave?: (value: string) => void
  onDismiss?: () => void
}) {
  const [draft, setDraft] = useState('')
  const open = status === 'open'
  const save = () => {
    const value = draft.trim()
    if (!open || !value) return
    onSave?.(value)
    setDraft('')
  }
  return (
    <div testId={testId ?? 'secret-request'} style={CARD_STYLE}>
      <div style={{ fontSize: T.type.sm, color: T.text }}>{connectorName}</div>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>
        Stays out of the chat. Stored securely, never shown to an automaton.
      </div>
      {open ? (
        <>
          <textarea
            testId="secret-request-input"
            value={draft}
            placeholder="Paste the key here, not in chat"
            minRows={1}
            maxRows={2}
            theme={CHAT_THEME}
            style={FIELD_STYLE}
            onChange={(event) => setDraft(event.value ?? '')}
          />
          <div
            testId="secret-request-save"
            style={{
              alignSelf: 'flex-start',
              paddingLeft: T.space.md,
              paddingRight: T.space.md,
              paddingTop: T.space.xs,
              paddingBottom: T.space.xs,
              borderRadius: T.radius.sm,
              backgroundColor: T.raised,
              fontSize: T.type.sm,
              color: T.text,
              ...HIT,
            }}
            onClick={save}
          >
            Save securely
          </div>
          {onDismiss ? (
            <div
              testId="secret-request-dismiss"
              style={{
                alignSelf: 'flex-start',
                fontSize: T.type.sm,
                color: T.secondary,
                ...HIT,
              }}
              onClick={onDismiss}
            >
              Dismiss
            </div>
          ) : null}
        </>
      ) : (
        <div testId="secret-request-configured" style={{ fontSize: T.type.sm, color: T.secondary }}>
          {configured || status === 'saved' ? 'Configured' : 'Dismissed'}
        </div>
      )}
    </div>
  )
}
