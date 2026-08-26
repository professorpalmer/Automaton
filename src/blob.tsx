import { existsSync } from 'node:fs'
import { join } from 'node:path'
import React, { useEffect, useState } from 'react'
import { motion } from '@gpuix/react'
import { allFrameNames } from '../scripts/bake-marks'
import type { Agent } from './domain'
import { markForAgent, resolveFramePath } from './runtime/factory'
import { T } from './tokens'

export type ChewSide = 'a' | 'b'

export type BlobView = {
  selected: boolean
  unread: number
  mouthBusy: boolean
  chewSide: ChewSide
  index: number
  entered: boolean
}

export type BlobWeights = {
  rest: number
  breathe: number
  selected: number
  chewA: number
  chewB: number
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
  { weight: 'chewA', frame: 'chew-a' },
  { weight: 'chewB', frame: 'chew-b' },
]

const ZERO: BlobWeights = { rest: 0, breathe: 0, selected: 0, chewA: 0, chewB: 0 }

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

/** Five still poses. Jobs are not an input — only mouthBusy chews. */
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
      weights: hold(view.chewSide === 'b' ? 'chewB' : 'chewA'),
      duration: T.blob.chewMs / 1000,
      layoutDuration: T.motion.selected,
      delay,
      ease: 'easeInOut',
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
  const [entered, setEntered] = useState(false)
  const [chewSide, setChewSide] = useState<ChewSide>('a')

  useEffect(() => {
    setEntered(true)
  }, [])

  useEffect(() => {
    if (!blobNeedsClock(mouthBusy)) {
      setChewSide('a')
      return
    }
    const timer = setInterval(() => {
      setChewSide((side) => (side === 'a' ? 'b' : 'a'))
    }, T.blob.chewMs)
    return () => clearInterval(timer)
  }, [mouthBusy])

  const motionState = presentBlob({
    selected,
    unread,
    mouthBusy,
    chewSide,
    index,
    entered,
  })
  const insetX = (T.blob.slot - motionState.glyphWidth) / 2
  const insetY = (T.blob.slot - motionState.glyphHeight) / 2 + motionState.lift

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
      </motion.div>
    </div>
  )
}
