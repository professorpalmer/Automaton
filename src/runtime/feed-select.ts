import type { FeedItem } from '../domain'
import { copyTextToClipboard } from './clipboard'

export function feedMsgIds(items: FeedItem[]): string[] {
  return items.filter((item) => item.kind === 'msg').map((item) => item.id)
}

export function hitMsgIdAtY(
  rows: readonly { id: string; y: number; height: number }[],
  y: number,
): string | null {
  let hit: string | null = null
  for (const row of rows) {
    if (row.height <= 0) continue
    if (y >= row.y && y < row.y + row.height) hit = row.id
  }
  return hit
}

export function selectFeedRange(msgIds: string[], fromId: string, toId: string): string[] {
  const start = msgIds.indexOf(fromId)
  const end = msgIds.indexOf(toId)
  if (end < 0) return [toId]
  if (start < 0) return [toId]
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return msgIds.slice(lo, hi + 1)
}

export function selectedFeedText(
  items: FeedItem[],
  selected: Iterable<string>,
  fallbackId?: string | null,
): string {
  const ids = new Set(selected)
  const msgs = items.filter((item) => item.kind === 'msg')
  const picked = msgs.filter((item) => ids.has(item.id))
  const rows = picked.length > 0 ? picked : msgs.filter((item) => item.id === fallbackId)
  return rows
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function copyFeedSelection(
  items: FeedItem[],
  selected: Iterable<string>,
  fallbackId?: string | null,
): boolean {
  return copyTextToClipboard(selectedFeedText(items, selected, fallbackId))
}
