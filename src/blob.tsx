import { existsSync } from 'node:fs'
import { join } from 'node:path'
import React, { useEffect, useState } from 'react'
import { motion } from '@gpuix/react'
import { allFrameNames } from '../scripts/bake-marks'
import type { Agent } from './domain'
import { markForAgent, resolveFramePath } from './runtime/factory'
import { clockDuration, runningTests } from './runtime/test-env'
import { T } from './tokens'

export type BlobView = {
  selected: boolean
  unread: number
  mouthBusy: boolean
  index: number
  entered: boolean
}

export type BlobWeights = {
  rest: number
  breathe: number
  selected: number
  body: number
}

export type BlobMotion = {
  glyphWidth: number
  glyphHeight: number
  lift: number
  weights: BlobWeights
  duration: number
  layoutDuration: number
  delay: number
  ease: 'easeOut' | 'easeInOut'
}

export type BusyLook = { x: number; y: number }

/** Slow glances. Not a left/right chew flip. */
export const BUSY_LOOKS: BusyLook[] = [
  { x: 0, y: 0 },
  { x: 1, y: -0.55 },
  { x: -0.85, y: 0.35 },
  { x: 0.45, y: 0.75 },
  { x: -1, y: -0.25 },
]

export const SEED_MARKS: Record<string, { shape: string; tint: string }> = {
  staff: { shape: 'blob', tint: 'staff' },
  kernel: { shape: 'hex', tint: 'kernel' },
  research: { shape: 'tablet', tint: 'research' },
}

const MARKS_ROOT = join(import.meta.dir, 'marks')

const POSE_LAYERS: { weight: keyof BlobWeights; frame: string }[] = [
  { weight: 'rest', frame: 'rest' },
  { weight: 'breathe', frame: 'breathe' },
  { weight: 'selected', frame: 'selected' },
  { weight: 'body', frame: 'body' },
]

const ZERO: BlobWeights = { rest: 0, breathe: 0, selected: 0, body: 0 }

export function blobTestId(id: string): string {
  return `blob-${id}`
}

export function markFor(agent: Pick<Agent, 'id'>): { shape: string; tint: string } {
  const mark = markForAgent(agent.id)
  return { shape: mark.shape, tint: mark.color }
}

export function framePath(shape: string, tint: string, frame: string): string {
  return resolveFramePath(shape, tint, frame)
}

export function seedFramePath(agentId: string, frame: string): string {
  const mark = SEED_MARKS[agentId] ?? SEED_MARKS.staff
  return join(MARKS_ROOT, mark.shape, mark.tint, `${frame}.png`)
}

export function assertSeedFrames(): void {
  for (const id of Object.keys(SEED_MARKS)) {
    const mark = SEED_MARKS[id]
    for (const frame of allFrameNames()) {
      const path = join(MARKS_ROOT, mark.shape, mark.tint, `${frame}.png`)
      if (!existsSync(path)) throw new Error(`missing seed frame ${path}`)
    }
  }
}

export function blobNeedsClock(mouthBusy: boolean): boolean {
  return mouthBusy
}

function hold(weight: keyof BlobWeights): BlobWeights {
  return { ...ZERO, [weight]: 1 }
}

/** Idle and selected are still PNGs. Mouth-busy is an eyeless body; eyes are overlay dots. */
export function presentBlob(view: BlobView): BlobMotion {
  const delay = view.entered ? 0 : view.index * T.blob.stagger
  if (!view.entered) {
    return {
      glyphWidth: T.blob.enterSize,
      glyphHeight: T.blob.enterSize,
      lift: 0,
      weights: hold('rest'),
      duration: T.motion.enter,
      layoutDuration: T.motion.enter,
      delay,
      ease: 'easeOut',
    }
  }
  if (view.mouthBusy) {
    return {
      glyphWidth: T.blob.size,
      glyphHeight: T.blob.size,
      lift: view.selected ? T.blob.selectedLift : 0,
      weights: hold('body'),
      duration: T.motion.selected,
      layoutDuration: T.motion.selected,
      delay,
      ease: 'easeOut',
    }
  }
  if (view.selected) {
    return {
      glyphWidth: T.blob.size,
      glyphHeight: T.blob.size,
      lift: T.blob.selectedLift,
      weights: hold('selected'),
      duration: T.motion.selected,
      layoutDuration: T.motion.selected,
      delay,
      ease: 'easeOut',
    }
  }
  return {
    glyphWidth: T.blob.size,
    glyphHeight: T.blob.size,
    lift: 0,
    weights: hold('rest'),
    duration: T.blob.breatheMs / 1000,
    layoutDuration: T.motion.selected,
    delay,
    ease: 'easeInOut',
  }
}

export function busyEyeLayout(
  look: number,
  blink: boolean,
): { left: number; top: number; width: number; height: number }[] {
  const glance = BUSY_LOOKS[((look % BUSY_LOOKS.length) + BUSY_LOOKS.length) % BUSY_LOOKS.length]
  const height = blink ? T.space.xxs : T.blob.eye
  const pairX = T.blob.eyeX + glance.x * T.blob.eyeWander
  const pairY = T.blob.eyeY + glance.y * T.blob.eyeWander
  const top = pairY - height / 2
  return [-1, 1].map((side) => ({
    left: pairX + side * (T.blob.eyeGap / 2) - T.blob.eye / 2,
    top,
    width: T.blob.eye,
    height,
  }))
}

export function SisterBlob({
  agent,
  selected,
  unread,
  mouthBusy,
  index,
}: {
  agent: Agent
  selected: boolean
  unread: number
  mouthBusy: boolean
  index: number
}) {
  const mark = markFor(agent)
  const [entered, setEntered] = useState(() => runningTests())
  const [look, setLook] = useState(0)
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    setEntered(true)
  }, [])

  useEffect(() => {
    if (!blobNeedsClock(mouthBusy)) {
      setLook(0)
      setBlink(false)
      return
    }
    const wander = setInterval(() => {
      setLook((n) => n + 1)
    }, T.blob.wanderMs)
    let close: ReturnType<typeof setTimeout> | undefined
    const lids = setInterval(() => {
      setBlink(true)
      close = setTimeout(() => setBlink(false), T.blob.blinkMs)
    }, T.blob.blinkEveryMs)
    return () => {
      clearInterval(wander)
      clearInterval(lids)
      if (close) clearTimeout(close)
    }
  }, [mouthBusy])

  const motionState = presentBlob({
    selected,
    unread,
    mouthBusy,
    index,
    entered,
  })
  const insetX = (T.blob.slot - motionState.glyphWidth) / 2
  const insetY = (T.blob.slot - motionState.glyphHeight) / 2 + motionState.lift
  const showEyes = Boolean(entered && mouthBusy)
  const eyes = showEyes ? busyEyeLayout(look, blink) : []

  return (
    <div
      testId={blobTestId(agent.id)}
      style={{
        width: T.blob.slot,
        height: T.blob.slot,
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        hover: { opacity: T.blob.hover },
        active: { opacity: T.blob.active },
      }}
    >
      <motion.div
        initial={false}
        animate={{
          width: motionState.glyphWidth,
          height: motionState.glyphHeight,
          top: insetY,
          left: insetX,
        }}
        transition={{
          duration: motionState.layoutDuration,
          delay: motionState.delay,
          ease: motionState.ease,
        }}
        style={{
          position: 'absolute',
          width: motionState.glyphWidth,
          height: motionState.glyphHeight,
          top: insetY,
          left: insetX,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {POSE_LAYERS.map((layer) => (
          <motion.div
            key={layer.frame}
            initial={false}
            animate={{ opacity: motionState.weights[layer.weight] }}
            transition={{
              duration: motionState.duration,
              delay: motionState.delay,
              ease: motionState.ease,
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: motionState.glyphWidth,
              height: motionState.glyphHeight,
              pointerEvents: 'none',
            }}
          >
            <img
              src={framePath(mark.shape, mark.tint, layer.frame)}
              objectFit="contain"
              alt=""
              style={{
                width: motionState.glyphWidth,
                height: motionState.glyphHeight,
                pointerEvents: 'none',
              }}
            />
          </motion.div>
        ))}
        {eyes.map((eye, side) => (
          <motion.div
            key={side}
            testId={side === 0 ? `blob-eye-${agent.id}-left` : `blob-eye-${agent.id}-right`}
            initial={false}
            animate={{ left: eye.left, top: eye.top, height: eye.height }}
            transition={{
              duration: clockDuration(blink ? T.blob.blinkMs / 1000 : T.blob.wanderMs / 1000),
              ease: 'easeInOut',
            }}
            style={{
              position: 'absolute',
              left: eye.left,
              top: eye.top,
              width: eye.width,
              height: eye.height,
              borderRadius: T.blob.eye,
              backgroundColor: T.catalog.black,
              pointerEvents: 'none',
            }}
          />
        ))}
      </motion.div>
    </div>
  )
}
