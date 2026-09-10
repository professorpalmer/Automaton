import type { FeedItem } from '../domain'

/** Comet/Zeron STREAM_COMMIT: coalesce tail pins so grow ticks do not scroll every char. */
export const STREAM_COMMIT_MS = 120

/** Bottom-aligned virtual-list park. gpuix clamps this to the real min offset. */
export const FEED_TAIL = -1_000_000

/** Stay on the tail while the last offset is still within this many pixels of the park. */
export const FEED_NEAR_TAIL_PX = 80

export type FeedPinReason = 'mount' | 'identity' | 'grow'

export type FeedPinRenderer = {
  getScrollOffset?: (id: number) => [number, number] | null | undefined
  getElementBounds?: (id: number) => number[] | null | undefined
  scrollTo?: (id: number, x: number, y: number) => void
  scrollToItem?: (id: number, index: number) => void
}

/** Identity for follow-tail. Must not include last-message text length. */
export function feedPinIdentity(items: FeedItem[], dockPad: number, thinking: boolean): string {
  const last = items.at(-1)
  if (!last) return `empty:${dockPad}:${thinking ? 't' : 'f'}`
  return `${items.length}:${last.id}:${dockPad}:${thinking ? 't' : 'f'}`
}

export function feedGrowKey(items: FeedItem[]): string {
  const last = items.at(-1)
  if (!last) return 'empty'
  if (last.kind === 'msg') return `${last.id}:${last.text.length}`
  return last.id
}

export function paintedFeedCount(items: FeedItem[], thinking = false): number {
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

export function shouldPinFeedTail(input: {
  reason: FeedPinReason
  nearBottom: boolean
  atTail: boolean
}): boolean {
  if (input.reason === 'grow') {
    if (input.atTail) return false
    return input.nearBottom
  }
  return true
}

/** Compare the live offset to the last parked tail after a pin. */
export function feedFollowFromPark(
  offsetY: number | null,
  parkedY: number | null,
  slack = FEED_NEAR_TAIL_PX,
): { nearBottom: boolean; atTail: boolean } {
  if (offsetY == null || parkedY == null) return { nearBottom: true, atTail: false }
  return {
    nearBottom: offsetY <= parkedY + slack,
    atTail: Math.abs(offsetY - parkedY) <= 1,
  }
}

export function readFeedOffsetY(renderer: FeedPinRenderer | null, node: { id: number } | null): number | null {
  if (!renderer || !node || typeof renderer.getScrollOffset !== 'function') return null
  const offset = renderer.getScrollOffset(node.id)
  if (!offset || offset.length < 2) return null
  const y = offset[1]
  return typeof y === 'number' && Number.isFinite(y) ? y : null
}

export type FeedPinTimer = { current: ReturnType<typeof setTimeout> | null }

export function scheduleFeedPin(
  run: () => void,
  timer: FeedPinTimer,
  coalesceMs: number,
): void {
  if (coalesceMs <= 0) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    run()
    return
  }
  if (timer.current) return
  timer.current = setTimeout(() => {
    timer.current = null
    run()
  }, coalesceMs)
}

export function cancelFeedPin(timer: FeedPinTimer): void {
  if (!timer.current) return
  clearTimeout(timer.current)
  timer.current = null
}

export function pinFeedTail(
  renderer: FeedPinRenderer | null,
  node: { id: number } | null,
  items: FeedItem[],
  thinking: boolean,
): number | null {
  if (!renderer || !node) return null
  const count = paintedFeedCount(items, thinking)
  if (count > 0) renderer.scrollToItem?.(node.id, count - 1)
  renderer.scrollTo?.(node.id, 0, FEED_TAIL)
  return readFeedOffsetY(renderer, node)
}
