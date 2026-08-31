import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GELATIN, motion } from '@gpuix/react'
import { allFrameNames } from '../scripts/bake-marks'
import type { Agent } from './domain'
import { catalogHex, markForAgent, resolveFramePath } from './runtime/factory'
import { runningTests } from './runtime/test-env'
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

const REST_LOOK: BusyLook = { x: 0, y: 0 }

export const SEED_MARKS: Record<string, { shape: string; tint: string }> = {
  staff: { shape: 'blob', tint: 'staff' },
  kernel: { shape: 'hex', tint: 'kernel' },
  research: { shape: 'tablet', tint: 'research' },
}

const MARKS_ROOT = join(import.meta.dir, 'marks')
const SVG_DIR = join(import.meta.dir, 'marks', 'grokbot')

const SLIT_SHAPES = new Set(['hex', 'crystal', 'tablet', 'gem', 'cylinder'])

const ZERO: BlobWeights = { rest: 0, breathe: 0, selected: 0, body: 0 }

const BODY_SPRING = {
  type: 'spring' as const,
  stiffness: GELATIN.stiffness,
  damping: GELATIN.damping,
  mass: GELATIN.mass,
}
const EYE_SPRING = { type: 'spring' as const, stiffness: 18, damping: 7, mass: 1.0 }

/** Grey selected plate. Static box; only opacity springs. */
const PLATE_INSET = 2
const PLATE_RADIUS = 12

export const BLOB_POSES = ['rest', 'wide', 'tall'] as const
export type BlobPose = (typeof BLOB_POSES)[number]
export type BlobMelt = BlobPose | 'soft-wide' | 'soft-tall'

/** ViewBox "-15 -15 259 259" center. Baked into pose stamps, never layout. */
const VIEW_CX = 114.5
const VIEW_CY = 114.5

const POSE_SCALE: Record<BlobPose, readonly [number, number]> = {
  rest: [1, 1],
  wide: [1.1, 0.88],
  tall: [0.88, 1.1],
}

const svgCache = new Map<string, string>()

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

export function blobNeedsClock(alive: boolean): boolean {
  return alive
}

function hold(weight: keyof BlobWeights): BlobWeights {
  return { ...ZERO, [weight]: 1 }
}

function px(n: number): number {
  return Math.round(n)
}

export function presentBlob(view: BlobView): BlobMotion {
  const delay = view.entered ? 0 : view.index * T.blob.stagger
  if (!view.entered) {
    return {
      glyphWidth: T.blob.size,
      glyphHeight: T.blob.size,
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
      lift: 0,
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
      lift: 0,
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

/** Thin alias: species names are the markShape keys themselves. */
export function speciesForShape(shape: string, _tint = ''): string {
  return shape
}

export function eyeKindForSpecies(species: string): 'dot' | 'slit' {
  return SLIT_SHAPES.has(species) ? 'slit' : 'dot'
}

/** Mostly rest. Occasional glance at the neighbor above/below this rail index. */
export function neighborGlance(id: string, look: number, index: number): BusyLook {
  if (blobHash(id, `hold:${look}`) % 5 !== 0) return REST_LOOK
  if (index > 0 && blobHash(id, `dir:${look}`) % 2 === 0) return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

/** Mostly rest. Occasional wide/tall silhouette on a look beat. Independent FNV. */
export function idlePose(id: string, look: number): BlobPose {
  if (blobHash(id, `pose-hold:${look}`) % 5 !== 0) return 'rest'
  return blobHash(id, `pose-kind:${look}`) % 2 === 0 ? 'wide' : 'tall'
}

/** Working squash. Wide/tall more often; rest is a hold, not the default. */
export function workPose(id: string, look: number): BlobPose {
  const lane = blobHash(id, `work-pose:${look}`) % 3
  if (lane === 0) return 'rest'
  return lane === 1 ? 'wide' : 'tall'
}

/** Inner melt box inside FrozenMark. Rest fills the host; wide/tall stay centered. */
const POSE_EXTENT: Record<BlobMelt, readonly [number, number]> = {
  rest: [T.blob.size, T.blob.size],
  'soft-wide': [40, 36],
  'soft-tall': [36, 40],
  wide: [42, 34],
  tall: [34, 42],
}

export function poseLayout(
  pose: BlobMelt,
  hostW = T.blob.size,
  hostH = T.blob.size,
): { left: number; top: number; width: number; height: number } {
  const rest = T.blob.size
  const [nw, nh] = POSE_EXTENT[pose]
  const width = px(hostW * (nw / rest))
  const height = px(hostH * (nh / rest))
  return {
    left: px((hostW - width) / 2),
    top: px((hostH - height) / 2),
    width,
    height,
  }
}

/** Near-rest squash on every look so GELATIN never sits frozen at 38×38. */
export function restMelt(id: string, look: number): BlobMelt {
  const lane = blobHash(id, `soft-hold:${look}`) % 3
  if (lane === 0) return 'rest'
  return lane === 1 ? 'soft-wide' : 'soft-tall'
}

export function busyEyeLayout(
  look: number,
  blink: boolean,
  kind: 'dot' | 'slit' = 'dot',
  glance: BusyLook | null = null,
): { left: number; top: number; width: number; height: number }[] {
  const used = glance ?? (BUSY_LOOKS[((look % BUSY_LOOKS.length) + BUSY_LOOKS.length) % BUSY_LOOKS.length] ?? REST_LOOK)
  const openH = kind === 'slit' ? Math.max(2, T.blob.eye - 1) : T.blob.eye
  const openW = kind === 'slit' ? T.blob.eye + 1 : T.blob.eye
  const height = blink ? T.space.xxs : openH
  const width = blink ? openW + 1 : openW
  const pairX = T.blob.eyeX + used.x * T.blob.eyeWander
  const pairY = T.blob.eyeY + used.y * T.blob.eyeWander
  const top = pairY - height / 2
  return [-1, 1].map((side) => ({
    left: pairX + side * (T.blob.eyeGap / 2) - width / 2,
    top,
    width,
    height,
  }))
}

function loadShapeSvg(shape: string): string {
  const key = shape || 'blob'
  const hit = svgCache.get(key)
  if (hit) return hit
  const file = join(SVG_DIR, `${key}.svg`)
  const fallback = join(SVG_DIR, 'blob.svg')
  const path = existsSync(file) ? file : fallback
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : ''
  svgCache.set(key, raw)
  return raw
}

/**
 * GPUIX `<svg source>` is a monochrome mask tinted by host `style.color`.
 * `fill=` in this markup is for tests/export. True path fill belongs in
 * canvas.rs upstream — do not metal-build that tonight.
 *
 * 1× stamp of the 259 viewBox. No inflate, no stroke, overflow hidden.
 * Do not rebuild this string on clock ticks.
 */
export function shapeSvgSource(shape: string, tintHex: string, size: number): string {
  let svg = loadShapeSvg(shape)
  if (!svg) return ''
  svg = svg.replace('fill="#000"', `fill="${tintHex}"`)
  svg = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let rest = String(attrs)
      .replace(/\swidth="[^"]*"/g, '')
      .replace(/\sheight="[^"]*"/g, '')
      .replace(/\soverflow="[^"]*"/g, '')
    return `<svg width="${size}" height="${size}" overflow="hidden"${rest}>`
  })
  return svg
}

/** Wrap the evenodd path once. Do not call this on clock ticks. */
export function bakePoseSvg(svg: string, pose: BlobPose): string {
  if (pose === 'rest' || !svg.includes('<path')) return svg
  const [sx, sy] = POSE_SCALE[pose]
  const transform = `translate(${VIEW_CX},${VIEW_CY}) scale(${sx.toFixed(2)},${sy.toFixed(2)}) translate(${-VIEW_CX},${-VIEW_CY})`
  return svg.replace('<path', `<g transform="${transform}"><path`).replace('</svg>', '</g></svg>')
}

const poseStampCache = new Map<string, Record<BlobPose, string>>()

/** Three stamps, baked once per shape+tint. Rest / wide / tall. */
export function poseSvgStamps(shape: string, tintHex: string, size: number): Record<BlobPose, string> {
  const key = `${shape}|${tintHex}|${size}`
  const hit = poseStampCache.get(key)
  if (hit) return hit
  const rest = shapeSvgSource(shape, tintHex, size)
  const stamps: Record<BlobPose, string> = {
    rest,
    wide: bakePoseSvg(rest, 'wide'),
    tall: bakePoseSvg(rest, 'tall'),
  }
  poseStampCache.set(key, stamps)
  return stamps
}

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

/** Stable FNV-1a from agent.id. Not Math.random, not per-render. */
export function blobHash(id: string, lane = ''): number {
  const text = lane ? `${id}:${lane}` : id
  let hash = FNV_OFFSET >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

export function blobUnit(id: string, lane = ''): number {
  return blobHash(id, lane) / 0x100000000
}

export type BlobClock = {
  phaseOffset: number
  breathePeriod: number
  wanderMs: number
  blinkEveryMs: number
  blinkDelayMs: number
  lookStart: number
}

export function blobClock(id: string): BlobClock {
  const phase = blobUnit(id, 'phase')
  const breathe = blobUnit(id, 'breathe')
  const wander = blobUnit(id, 'wander')
  const blink = blobUnit(id, 'blink')
  const blink0 = blobUnit(id, 'blink0')
  return {
    phaseOffset: phase * Math.PI * 2,
    breathePeriod: T.blob.breatheMs * (0.75 + breathe * 0.55),
    wanderMs: T.blob.wanderMs * (2.4 + wander * 1.4),
    blinkEveryMs: T.blob.blinkEveryMs * (0.5 + blink * 1.0),
    blinkDelayMs: blink0 * T.blob.blinkEveryMs,
    lookStart: blobHash(id, 'look') % BUSY_LOOKS.length,
  }
}

/** Wander sometimes skips 1-2 beats so the glance cycle is not a GIF. */
export function nextLook(id: string, look: number): number {
  const skip = blobHash(id, `wander-skip:${look}`) % 5 === 0 ? 1 + (blobHash(id, `wander-beats:${look}`) % 2) : 0
  return look + 1 + skip
}

export function blobDoubleBlink(id: string, beat: number): boolean {
  return blobHash(id, `double-blink:${beat}`) % 5 === 0
}

function svgStampStyle(tint: string) {
  return {
    width: '100%',
    height: '100%',
    color: tint,
    overflow: 'hidden' as const,
    pointerEvents: 'none' as const,
  }
}

const BodyGlyph = React.memo(function BodyGlyph({
  shape,
  fill,
}: {
  shape: string
  fill: string
}) {
  const bodySvg = useMemo(() => shapeSvgSource(shape, fill, T.blob.size), [shape, fill])
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <svg source={bodySvg} style={svgStampStyle(fill)} />
    </div>
  )
})

const FrozenMark = React.memo(function FrozenMark({
  shape,
  fill,
  left,
  top,
  width,
  height,
  unread,
  pose,
  dragging,
}: {
  shape: string
  fill: string
  left: number
  top: number
  width: number
  height: number
  unread: number
  pose: BlobMelt
  dragging: boolean
}) {
  const box = dragging ? { left: 0, top: 0, width, height } : poseLayout(pose, width, height)
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <motion.div
        initial={false}
        animate={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        }}
        transition={dragging ? { type: 'tween' as const, duration: 0 } : BODY_SPRING}
        style={{
          position: 'absolute',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <BodyGlyph shape={shape} fill={fill} />
      </motion.div>
      {unread > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: width - 4,
            top: -2,
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: T.catalog.red,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  )
})

function eyeSvgSource(kind: 'dot' | 'slit'): string {
  const openW = kind === 'slit' ? T.blob.eye + 1 : T.blob.eye
  const openH = kind === 'slit' ? Math.max(2, T.blob.eye - 1) : T.blob.eye
  const w = openW * 2
  const h = openH * 2
  if (kind === 'slit') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden"><rect x="0" y="0" width="${w}" height="${h}" rx="2" fill="${T.catalog.black}"/></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${T.catalog.black}"/></svg>`
}

export function SisterBlob({
  agent,
  selected,
  unread,
  mouthBusy,
  alive,
  index,
  onSelect,
  onMenu,
}: {
  agent: Agent
  selected: boolean
  unread: number
  mouthBusy: boolean
  alive?: boolean
  index: number
  onSelect?: () => void
  onMenu?: (event: { x?: number; y?: number; isRightClick?: boolean; button?: number }) => void
}) {
  const live = alive ?? mouthBusy
  const mark = markFor(agent)
  const fill = catalogHex(mark.tint)
  const eyeKind = eyeKindForSpecies(mark.shape)
  const clock = useMemo(() => blobClock(agent.id), [agent.id])
  const eyeSvg = useMemo(() => eyeSvgSource(eyeKind), [eyeKind])
  const [entered, setEntered] = useState(() => runningTests())
  const [look, setLook] = useState(() => clock.lookStart)
  const [blink, setBlink] = useState(false)
  const [pointer, setPointer] = useState({ x: 0, y: 0, vx: 0, vy: 0, down: false })
  const last = useRef({ x: 0, y: 0, t: 0 })
  const lastPose = useRef<BlobPose>('rest')
  const smears = useRef<{ x: number; y: number; o: number }[]>([])

  useEffect(() => {
    setEntered(true)
  }, [])

  useEffect(() => {
    if (!blobNeedsClock(live)) {
      setLook(clock.lookStart)
      setBlink(false)
      return
    }
    const wander = setInterval(() => {
      setLook((n) => nextLook(agent.id, n))
    }, clock.wanderMs)
    let close: ReturnType<typeof setTimeout> | undefined
    let lids: ReturnType<typeof setTimeout> | undefined
    let reopen: ReturnType<typeof setTimeout> | undefined
    let beat = 0
    const scheduleBlink = (delay: number) => {
      lids = setTimeout(() => {
        const doubled = blobDoubleBlink(agent.id, beat)
        beat += 1
        setBlink(true)
        close = setTimeout(() => {
          setBlink(false)
          if (doubled) {
            reopen = setTimeout(() => {
              setBlink(true)
              close = setTimeout(() => setBlink(false), T.blob.blinkMs)
            }, T.blob.blinkMs + 50)
          }
          scheduleBlink(clock.blinkEveryMs)
        }, T.blob.blinkMs)
      }, delay)
    }
    scheduleBlink(clock.blinkDelayMs)
    return () => {
      clearInterval(wander)
      if (lids) clearTimeout(lids)
      if (close) clearTimeout(close)
      if (reopen) clearTimeout(reopen)
    }
  }, [live, agent.id, clock.lookStart, clock.wanderMs, clock.blinkEveryMs, clock.blinkDelayMs])

  void presentBlob({
    selected,
    unread,
    mouthBusy,
    index,
    entered,
  })

  const size = T.blob.size
  const slot = T.blob.slot
  const squashX = pointer.down ? 1 + Math.abs(pointer.vx) * 0.07 : 1
  const squashY = pointer.down ? Math.max(0.82, 1 - Math.abs(pointer.vx) * 0.045) : 1
  const glyphWidth = px(size * squashX)
  const glyphHeight = px(size * squashY)
  const glyphLeft = px((slot - glyphWidth) / 2 + (pointer.down ? pointer.x : 0))
  const glyphTop = px((slot - glyphHeight) / 2 + (pointer.down ? pointer.y : 0))
  if (!live) lastPose.current = 'rest'
  const glance = live ? neighborGlance(agent.id, look, index) : REST_LOOK
  const rawPose = !live || look === clock.lookStart ? 'rest' : workPose(agent.id, look)
  const pose: BlobPose = lastPose.current !== 'rest' && rawPose !== 'rest' ? 'rest' : rawPose
  lastPose.current = pose
  const melt: BlobMelt = pose
  const eyes = entered ? busyEyeLayout(look, live && blink, eyeKind, glance) : []
  const svg = useMemo(
    () => shapeSvgSource(mark.shape, fill, T.blob.size),
    [mark.shape, fill],
  )
  const speed = Math.hypot(pointer.vx, pointer.vy)
  if (pointer.down && speed > 0.35) {
    smears.current = [{ x: glyphLeft, y: glyphTop, o: 0.35 }, ...smears.current].slice(0, 5)
  } else {
    smears.current = smears.current.map((s) => ({ ...s, o: s.o * 0.72 })).filter((s) => s.o > 0.04)
  }
  const trail = pointer.vx < 0 ? 0 : 1
  const plate = slot - PLATE_INSET * 2

  return (
    <div
      testId={blobTestId(agent.id)}
      onMouseDown={(event) => {
        if (event.isRightClick || event.button === 2) {
          onMenu?.(event)
          return
        }
        last.current = { x: event.x, y: event.y, t: Date.now() }
        setPointer((d) => ({ ...d, down: true }))
      }}
      onClick={(event) => {
        if (event.isRightClick || event.button === 2) return
        onSelect?.()
      }}
      onMouseMove={(event) => {
        if (!pointer.down) return
        const now = Date.now()
        const dt = Math.max(1, now - last.current.t)
        const dx = event.x - last.current.x
        const dy = event.y - last.current.y
        last.current = { x: event.x, y: event.y, t: now }
        setPointer((d) => ({
          x: d.x + dx,
          y: d.y + dy,
          vx: dx / dt,
          vy: dy / dt,
          down: true,
        }))
      }}
      onMouseUp={() => setPointer({ x: 0, y: 0, vx: 0, vy: 0, down: false })}
      onMouseLeave={() => {
        if (pointer.down) setPointer({ x: 0, y: 0, vx: 0, vy: 0, down: false })
      }}
      style={{
        width: slot,
        height: slot,
        position: 'relative',
        flexShrink: 0,
        overflow: 'visible',
        pointerEvents: 'auto',
        opacity: 1,
      }}
    >
      <motion.div
        testId={`blob-plate-${agent.id}`}
        initial={false}
        animate={{ opacity: selected ? 1 : 0 }}
        transition={BODY_SPRING}
        style={{
          position: 'absolute',
          left: PLATE_INSET,
          top: PLATE_INSET,
          width: plate,
          height: plate,
          borderRadius: PLATE_RADIUS,
          backgroundColor: T.selected,
          pointerEvents: 'none',
        }}
      />
      {smears.current.map((smear, i) => (
        <div
          key={`smear-${i}`}
          style={{
            position: 'absolute',
            left: smear.x,
            top: smear.y,
            width: glyphWidth,
            height: glyphHeight,
            opacity: smear.o,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <svg source={svg} style={svgStampStyle(fill)} />
        </div>
      ))}
      <FrozenMark
        shape={mark.shape}
        fill={fill}
        left={glyphLeft}
        top={glyphTop}
        width={glyphWidth}
        height={glyphHeight}
        unread={unread}
        pose={melt}
        dragging={pointer.down}
      />
      {eyes.map((eye, side) => (
        <motion.div
          key={side}
          testId={side === 0 ? `blob-eye-${agent.id}-left` : `blob-eye-${agent.id}-right`}
          initial={false}
          animate={{
            left: px(glyphLeft + eye.left + (pointer.down ? pointer.vx * 4 : 0)),
            top: px(glyphTop + eye.top + (pointer.down ? pointer.vy * 4 : 0)),
            height: px(eye.height),
            width: px(eye.width),
          }}
          transition={{
            ...EYE_SPRING,
            delay: side * 0.05 + (side === trail ? 0.04 : 0),
          }}
          style={{
            position: 'absolute',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <svg
            source={eyeSvg}
            style={svgStampStyle(T.catalog.black)}
          />
        </motion.div>
      ))}
    </div>
  )
}
