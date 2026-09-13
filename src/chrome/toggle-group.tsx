import React from 'react'
import { Chip } from '../ui'
import { useTokens } from '../theme'

export type ToggleOption<T extends string> = {
  id: T
  label: string
  testId?: string
}

/** Segmented chips — Window / Appearance / Brand / inspector kit. */
export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T
  options: readonly ToggleOption<T>[]
  onChange: (id: T) => void
  testId?: string
}) {
  const T = useTokens()
  return (
    <div
      testId={testId}
      style={{ display: 'flex', flexDirection: 'row', gap: T.space.xs, flexWrap: 'wrap' }}
    >
      {options.map((option) => (
        <Chip
          key={option.id}
          testId={option.testId}
          tone={value === option.id ? 'action' : 'ghost'}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  )
}
