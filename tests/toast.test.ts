import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  clearToasts,
  dismissToast,
  listToasts,
  pushToast,
  resetToastStore,
  subscribeToasts,
  toastLevelLabel,
  toastTtlMs,
} from '../src/chrome/toast-store'

describe('toast level policy', () => {
  beforeEach(() => resetToastStore())
  afterEach(() => resetToastStore())

  test('info/success 3s, warn 6s, error sticky', () => {
    expect(toastTtlMs('info')).toBe(3000)
    expect(toastTtlMs('success')).toBe(3000)
    expect(toastTtlMs('warn')).toBe(6000)
    expect(toastTtlMs('error')).toBeNull()
    expect(toastLevelLabel('error')).toBe('Error')
  })

  test('push dismiss clear and subscribe', () => {
    let ticks = 0
    const stop = subscribeToasts(() => {
      ticks += 1
    })
    const id = pushToast({ level: 'warn', message: 'Heads up' })
    expect(listToasts()).toHaveLength(1)
    expect(listToasts()[0]?.id).toBe(id)
    expect(ticks).toBe(1)
    dismissToast(id)
    expect(listToasts()).toHaveLength(0)
    expect(ticks).toBe(2)
    pushToast({ level: 'error', message: 'Nope', id: 'sticky-1' })
    pushToast({ level: 'error', message: 'Still nope', id: 'sticky-1' })
    expect(listToasts()).toHaveLength(1)
    expect(listToasts()[0]?.message).toBe('Still nope')
    clearToasts()
    expect(listToasts()).toHaveLength(0)
    stop()
  })
})
