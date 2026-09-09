import { useEffect, useRef, useState } from 'react'
import { runningTests } from './runtime/test-env'

/** Same cadence as gpuix `DEFAULT_FRAME_MS`. Do not replace that host loop. */
export const SPRING_FRAME_MS = 8

export type SpringParams = {
  type?: 'spring'
  stiffness: number
  damping: number
  mass: number
}

export type SpringChannel = {
  value: number
  velocity: number
}

const SNAP_POS = 1.05
const SNAP_VEL = 0.35
/** Soft GELATIN / EYE springs crawl; budget forces rest so the window can sleep. */
export const SETTLE_BUDGET_MS = 280
export const SETTLE_HARD_MS = 420

type Tick = (dtMs: number) => boolean

const ticks = new Set<Tick>()
let timer: ReturnType<typeof setTimeout> | null = null
let lastNow = 0

export function springClockBusy(): boolean {
  return ticks.size > 0
}

export function resetSpringClockForTests(): void {
  ticks.clear()
  if (timer !== null) clearTimeout(timer)
  timer = null
  lastNow = 0
}

function pump(): void {
  timer = null
  const now = performance.now()
  const dt = Math.min(32, Math.max(1, now - lastNow))
  lastNow = now
  for (const tick of [...ticks]) {
    if (!tick(dt)) ticks.delete(tick)
  }
  if (ticks.size === 0) return
  timer = setTimeout(pump, SPRING_FRAME_MS)
}

/** Subscribe a spring tick. Unsubscribes itself when the tick returns false (all rest). */
export function subscribeSpringTick(tick: Tick): () => void {
  ticks.add(tick)
  if (timer === null) {
    lastNow = performance.now()
    timer = setTimeout(pump, SPRING_FRAME_MS)
  }
  return () => {
    ticks.delete(tick)
    if (ticks.size === 0 && timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

export function stepSpringChannel(
  channel: SpringChannel,
  target: number,
  spring: SpringParams,
  dtMs: number,
): SpringChannel {
  const dt = Math.min(dtMs, 32) / 1000
  const mass = spring.mass > 0 ? spring.mass : 1
  const accel = (-spring.stiffness * (channel.value - target) - spring.damping * channel.velocity) / mass
  const velocity = channel.velocity + accel * dt
  const value = channel.value + velocity * dt
  return { value, velocity }
}

export function shouldSnapSpring(channel: SpringChannel, target: number, elapsedMs = 0): boolean {
  const dist = Math.abs(channel.value - target)
  if (Math.abs(channel.velocity) < SNAP_VEL && dist < SNAP_POS) return true
  if (elapsedMs >= SETTLE_BUDGET_MS && dist < 2.25) return true
  return elapsedMs >= SETTLE_HARD_MS
}

export function snapSpring(target: number): SpringChannel {
  return { value: target, velocity: 0 }
}

export function isSpringRest(channel: SpringChannel, target: number): boolean {
  return channel.velocity === 0 && channel.value === target
}

export function springShouldPublish(previous: number, next: number): boolean {
  return Math.round(next) !== Math.round(previous)
}

export function quantizeSpringValue(value: number): number {
  return Math.round(value)
}

function targetSignature(targets: Record<string, number>): string {
  return Object.keys(targets)
    .sort()
    .map((key) => `${key}:${targets[key]}`)
    .join('|')
}

function quantizeTargets(targets: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(targets)) out[key] = quantizeSpringValue(targets[key] ?? 0)
  return out
}

function channelsFrom(targets: Record<string, number>): Record<string, SpringChannel> {
  const out: Record<string, SpringChannel> = {}
  for (const key of Object.keys(targets)) out[key] = snapSpring(targets[key] ?? 0)
  return out
}

function allChannelsRest(channels: Record<string, SpringChannel>, targets: Record<string, number>): boolean {
  for (const key of Object.keys(targets)) {
    const channel = channels[key] ?? snapSpring(targets[key] ?? 0)
    if (!isSpringRest(channel, targets[key] ?? 0)) return false
  }
  return true
}

/**
 * Spring-drive numeric style channels. Publishes integer pixels only.
 * Unsubscribes the 8ms tick when every channel is at rest so GPUI can sleep.
 */
export function useRestingStyle(
  targets: Record<string, number>,
  spring: SpringParams,
  opts?: { immediate?: boolean },
): Record<string, number> {
  const immediate = opts?.immediate === true || runningTests()
  const signature = targetSignature(targets)
  const quantized = quantizeTargets(targets)
  const [painted, setPainted] = useState(quantized)
  const channelsRef = useRef<Record<string, SpringChannel>>(channelsFrom(targets))
  const paintedRef = useRef(quantized)
  const targetsRef = useRef(targets)
  targetsRef.current = targets

  useEffect(() => {
    const nextTargets = targetsRef.current
    const nextQuantized = quantizeTargets(nextTargets)
    if (immediate) {
      channelsRef.current = channelsFrom(nextTargets)
      paintedRef.current = nextQuantized
      setPainted(nextQuantized)
      return
    }
    const channels = channelsRef.current
    for (const key of Object.keys(nextTargets)) {
      if (!channels[key]) channels[key] = snapSpring(nextTargets[key] ?? 0)
    }
    if (allChannelsRest(channels, nextTargets)) return
    let elapsedMs = 0
    return subscribeSpringTick((dtMs) => {
      const live = targetsRef.current
      elapsedMs += dtMs
      let moving = false
      let changed = false
      const nextPainted = { ...paintedRef.current }
      for (const key of Object.keys(live)) {
        const target = live[key] ?? 0
        let channel = channels[key] ?? snapSpring(target)
        channel = stepSpringChannel(channel, target, spring, dtMs)
        if (shouldSnapSpring(channel, target, elapsedMs)) channel = snapSpring(target)
        channels[key] = channel
        if (!isSpringRest(channel, target)) moving = true
        if (springShouldPublish(nextPainted[key] ?? 0, channel.value)) {
          nextPainted[key] = quantizeSpringValue(channel.value)
          changed = true
        }
      }
      if (changed) {
        paintedRef.current = nextPainted
        setPainted(nextPainted)
      }
      return moving
    })
  }, [signature, immediate, spring])

  return immediate ? quantized : painted
}
