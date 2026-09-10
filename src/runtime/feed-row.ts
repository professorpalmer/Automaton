import type { FeedItem } from '../domain'

export type FeedRowPaint = {
  kind: FeedItem['kind']
  id: string
  text?: string
  from?: string
  at?: number
  lane?: string
  peerId?: string
  peerLabel?: string
  status?: string
  answer?: unknown
  configured?: boolean
  connectorId?: string
  selected?: boolean
  copied?: boolean
  fromStore?: boolean
  fromPeer?: string | null
  showClock?: boolean
  gap?: number
  mine?: boolean
  files?: readonly { id: string; path: string; kind: string }[]
  attachmentIds?: readonly string[]
}

/** Stable paint key. Growing another row must not change this string. */
export function feedRowFingerprint(paint: FeedRowPaint): string {
  const files = (paint.files ?? [])
    .map((file) => `${file.id}:${file.kind}:${file.path}`)
    .join(',')
  const attachments = (paint.attachmentIds ?? []).join(',')
  const answer = paint.answer === undefined ? '' : JSON.stringify(paint.answer)
  return [
    paint.kind,
    paint.id,
    paint.text ?? '',
    paint.from ?? '',
    paint.at ?? '',
    paint.lane ?? '',
    paint.peerId ?? '',
    paint.peerLabel ?? '',
    paint.status ?? '',
    answer,
    paint.configured === true ? '1' : '0',
    paint.connectorId ?? '',
    paint.selected === true ? '1' : '0',
    paint.copied === true ? '1' : '0',
    paint.fromStore === true ? '1' : '0',
    paint.fromPeer ?? '',
    paint.showClock === true ? '1' : '0',
    paint.gap ?? '',
    paint.mine === true ? '1' : '0',
    files,
    attachments,
  ].join('\u0001')
}

export function sameFeedRowFingerprint<T extends { fingerprint: string }>(prev: T, next: T): boolean {
  return prev.fingerprint === next.fingerprint
}
