import type { SpringParams } from '../resting-motion'
import { DEFAULT_TOKENS } from '../theme/tokens'

/** One catalog entry: duration + curve + optional delay. Call sites name the spec. */
export type MotionCurve = 'easeOut' | 'easeInOut' | 'linear'

export type MotionSpec = {
  duration: number
  curve: MotionCurve
  delay?: number
}

export type MotionName =
  | 'railResize'
  | 'paneIn'
  | 'unreadFade'
  | 'blobEnter'
  | 'blobSelected'
  | 'blobBreathe'
  | 'strip'
  | 'attachBar'

export const MOTION: Record<MotionName, MotionSpec> = {
  railResize: { duration: DEFAULT_TOKENS.motion.pane, curve: 'easeOut' },
  paneIn: { duration: DEFAULT_TOKENS.motion.pane, curve: 'easeOut' },
  unreadFade: { duration: DEFAULT_TOKENS.motion.unread, curve: 'easeOut' },
  blobEnter: { duration: DEFAULT_TOKENS.motion.enter, curve: 'easeOut' },
  blobSelected: { duration: DEFAULT_TOKENS.motion.selected, curve: 'easeOut' },
  blobBreathe: { duration: DEFAULT_TOKENS.motion.breathe, curve: 'easeInOut' },
  strip: { duration: DEFAULT_TOKENS.motion.strip, curve: 'easeOut' },
  attachBar: { duration: DEFAULT_TOKENS.attach.barMs, curve: 'easeOut' },
}

export type SpringName = 'gelatin' | 'eye'

export type SpringSpec = SpringParams & { type: 'spring' }

export const SPRINGS: Record<SpringName, SpringSpec> = {
  gelatin: { type: 'spring', stiffness: 28, damping: 8, mass: 1.25 },
  eye: { type: 'spring', stiffness: 13, damping: 14, mass: 1 },
}

export function motionSpec(name: MotionName): MotionSpec {
  return MOTION[name]
}

export function springSpec(name: SpringName): SpringSpec {
  return SPRINGS[name]
}
