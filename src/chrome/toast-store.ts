/** Toast stack helpers — rgitui ToastLevel policy (numbers only, no crate). */

export type ToastLevel = 'info' | 'success' | 'warn' | 'error'

export type ToastAction = {
  label: string
  onAction: () => void
}

export type ToastEntry = {
  id: string
  level: ToastLevel
  message: string
  action?: ToastAction
  createdAt: number
}

export type PushToastInput = {
  level: ToastLevel
  message: string
  action?: ToastAction
  id?: string
}

/** Info/success ~3s, warn ~6s, error sticky (null). */
export function toastTtlMs(level: ToastLevel): number | null {
  if (level === 'error') return null
  if (level === 'warn') return 6000
  return 3000
}

export function toastLevelLabel(level: ToastLevel): string {
  if (level === 'success') return 'Success'
  if (level === 'warn') return 'Warning'
  if (level === 'error') return 'Error'
  return 'Info'
}

let seq = 0
function nextId(prefix = 'toast'): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

type Listener = () => void

const listeners = new Set<Listener>()
let stack: ToastEntry[] = []

function emit() {
  for (const listener of listeners) listener()
}

export function listToasts(): ToastEntry[] {
  return stack
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pushToast(input: PushToastInput): string {
  const id = input.id?.trim() || nextId()
  const entry: ToastEntry = {
    id,
    level: input.level,
    message: input.message.trim() || toastLevelLabel(input.level),
    action: input.action,
    createdAt: Date.now(),
  }
  stack = [...stack.filter((row) => row.id !== id), entry]
  emit()
  return id
}

export function dismissToast(id: string): void {
  const next = stack.filter((row) => row.id !== id)
  if (next.length === stack.length) return
  stack = next
  emit()
}

export function clearToasts(): void {
  if (stack.length === 0) return
  stack = []
  emit()
}

/** Test/seam reset — parks empty so idle paint stays quiet. */
export function resetToastStore(): void {
  seq = 0
  stack = []
  listeners.clear()
}
