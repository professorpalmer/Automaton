import React, { useState } from 'react'
import type { QuestionWidget, WidgetAnswer, WidgetOption } from './domain'
import { widgetOptionValue } from './domain'
import { toChatTheme, useTokens, type GpuixTextTheme, type Tokens } from './theme'

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

function cardChrome(tokens: Tokens) {
  return {
    marginLeft: tokens.space.xl,
    marginRight: tokens.space.xl,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.raised,
    borderWidth: tokens.stroke.hairline,
    borderColor: tokens.border,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: tokens.space.sm,
  }
}

function fieldChrome(tokens: Tokens) {
  return {
    width: '100%',
    fontSize: tokens.type.sm,
    color: tokens.text,
    backgroundColor: tokens.composer,
    borderWidth: tokens.stroke.hairline,
    borderColor: tokens.border,
    borderRadius: tokens.radius.sm,
    paddingLeft: tokens.space.sm,
    paddingRight: tokens.space.sm,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
  }
}

function optionFill(
  tokens: Tokens,
  style: WidgetOption['style'],
  selected: boolean,
): { backgroundColor: string; color: string } {
  if (style === 'danger') return { backgroundColor: tokens.danger, color: tokens.inverse }
  if (style === 'primary' || selected) return { backgroundColor: tokens.inverse, color: tokens.onInverse }
  return { backgroundColor: tokens.raised, color: tokens.text }
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
  const T = useTokens()
  return (
    <div testId={testId} style={cardChrome(T)}>
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
  const T = useTokens()
  const chatTheme = toChatTheme(T)
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
    <div testId={testId ?? 'widget'} style={cardChrome(T)}>
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
          const fill = optionFill(T, option.style, selected)
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
          theme={chatTheme}
          style={fieldChrome(T)}
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

/**
 * Map a bullet-masked field onChange into the real secret.
 * GPUIX InputProps has no secureTextEntry/password — obscure display in React.
 */
export function applyMaskedSecretEdit(prior: string, reported: string): string {
  if (/^•*$/.test(reported)) return prior.slice(0, reported.length)
  let bullets = 0
  while (bullets < reported.length && reported[bullets] === '•') bullets += 1
  if (bullets > 0 && bullets <= prior.length) {
    return prior.slice(0, bullets) + reported.slice(bullets)
  }
  return reported.replace(/•/g, '')
}

export function MaskedSecretField({
  testId,
  value,
  placeholder,
  theme,
  style,
  onChange,
}: {
  testId: string
  value: string
  placeholder: string
  theme?: GpuixTextTheme
  // Looser than FIELD_STYLE so Settings (ui.FIELD_STYLE) can reuse this field.
  style?: object
  onChange: (next: string) => void
}) {
  return (
    <input
      testId={testId}
      value={'•'.repeat(value.length)}
      placeholder={placeholder}
      theme={theme}
      style={style}
      // Best-effort: pass through if a future GPUI build honors it (not in 0.6.1 InputProps).
      {...({ secureTextEntry: true, password: true } as object)}
      onChange={(event) => onChange(applyMaskedSecretEdit(value, event.value ?? ''))}
    />
  )
}

export function SecretRequestCard({
  testId,
  connectorName,
  description,
  fieldLabel,
  storeHint,
  status = 'open',
  configured,
  onSave,
  onDismiss,
}: {
  testId?: string
  connectorName: string
  description?: string
  fieldLabel?: string
  storeHint?: string
  status?: 'open' | 'saved' | 'dismissed'
  configured?: boolean
  onSave?: (value: string) => void
  onDismiss?: () => void
}) {
  const T = useTokens()
  const chatTheme = toChatTheme(T)
  const [draft, setDraft] = useState('')
  const open = status === 'open'
  const save = () => {
    const value = draft.trim()
    if (!open || !value) return
    onSave?.(value)
    setDraft('')
  }
  const help =
    description?.trim() ||
    'Stays out of the chat. Stored securely, never shown to an automaton.'
  return (
    <div testId={testId ?? 'secret-request'} style={cardChrome(T)}>
      <div style={{ fontSize: T.type.sm, color: T.text }}>{connectorName}</div>
      <div style={{ fontSize: T.type.xs, color: T.tertiary }}>{help}</div>
      {fieldLabel?.trim() ? (
        <div testId="secret-request-field-label" style={{ fontSize: T.type.xs, color: T.secondary }}>
          {fieldLabel.trim()}
        </div>
      ) : null}
      {storeHint?.trim() ? (
        <div testId="secret-request-store-hint" style={{ fontSize: T.type.xs, color: T.tertiary }}>
          {storeHint.trim()}
        </div>
      ) : null}
      {open ? (
        <>
          <MaskedSecretField
            testId="secret-request-input"
            value={draft}
            placeholder="Enter key — stays out of chat"
            theme={chatTheme}
            style={fieldChrome(T)}
            onChange={setDraft}
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
          {configured || status === 'saved' ? 'Provided' : 'Dismissed'}
        </div>
      )}
    </div>
  )
}
