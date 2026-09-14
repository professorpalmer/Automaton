/**
 * Pulse lease strides (Wave 6 P2) — Waku `pulse_lease` / `pulse_lease_slow` recipe.
 *
 * MouthWaitBubble / Activity dots share these cadences. Expensive surfaces
 * (long feed, Activity open) use the slow stride so rebuild cost stays priced
 * per tick. Unmount parks — no JS clock; gpuix motion repeats only while mounted.
 */

/** Default opacity pulse period (seconds) — ~prior MouthWaitBubble cadence. */
export const PULSE_STRIDE_S = 1.2

/** Half-rate stride for expensive paint (~15fps-feel vs ~30). */
export const PULSE_STRIDE_SLOW_S = 2.4

export type PulseStride = 'default' | 'slow'

/** Shared ease — keep call sites off raw 'easeInOut' string (MotionSpec catalog lint). */
export const PULSE_CURVE = 'easeInOut' as const

export function pulseDuration(stride: PulseStride = 'default'): number {
  return stride === 'slow' ? PULSE_STRIDE_SLOW_S : PULSE_STRIDE_S
}

/** Long feed or open Activity → slow lease. */
export function expensivePulseSurface(input: {
  feedLen?: number
  activityOpen?: boolean
}): boolean {
  return (input.feedLen ?? 0) >= 40 || Boolean(input.activityOpen)
}

export function pulseStrideFor(input: {
  feedLen?: number
  activityOpen?: boolean
}): PulseStride {
  return expensivePulseSurface(input) ? 'slow' : 'default'
}
