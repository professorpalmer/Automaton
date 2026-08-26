import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { T } from '../src/tokens'

export const BOX = 228.44
export const BAKE_SIZE = 128

type Pt = [number, number]
type Ball = { x: number; y: number; r: number }

export type MarkFrame = string
export type MarkShape = string
export type MarkPose = { squashY: number; spec: number; shine: number; key: Pt; keyZ: number }

const HEAD =
  'M228.541 114.228C228.541 130.133 225.184 145.994 218.738 160.534C212.674 174.217 203.904 186.669 193.065 196.988C155.933 232.34 99.497 238.596 55.5255 212.24C45.097 205.99 35.6851 198.072 27.7451 188.866C19.1926 178.953 12.3686 167.569 7.65781 155.351C2.60712 142.264 0 128.257 0 114.228C0 98.3219 3.35751 82.4611 9.80315 67.9215C15.8672 54.2382 24.6377 41.7862 35.4767 31.4668C72.6081 -3.88483 129.044 -10.1413 173.016 16.2153C183.444 22.4653 192.856 30.3829 200.796 39.5896C209.349 49.5018 216.173 60.8859 220.883 73.1037C225.934 86.1906 228.541 100.198 228.541 114.228Z'

export const MARK_BAKE_REV = 6

export const SEED_BAKES: { shape: MarkShape; tint: string; hex: string }[] = [
  { shape: 'blob', tint: 'staff', hex: T.staff.face },
  { shape: 'hex', tint: 'kernel', hex: T.kernel.face },
  { shape: 'tablet', tint: 'research', hex: T.research.face },
]

export type EyeLook = { dx: number; dy: number; open: number }

const REST_POSE: MarkPose = { squashY: 1, spec: 0.12, shine: 48, key: [-0.45, -0.65], keyZ: 0.6 }
const BREATHE_PEAK: MarkPose = { squashY: 1.02, spec: 0.14, shine: 46, key: [-0.45, -0.66], keyZ: 0.62 }
const SELECTED_POSE: MarkPose = { squashY: 1, spec: 0.18, shine: 40, key: [-0.38, -0.72], keyZ: 0.62 }

export function poseForName(frame: MarkFrame): MarkPose {
  if (frame === 'rest' || frame === 'body') return REST_POSE
  if (frame === 'breathe') return BREATHE_PEAK
  if (frame === 'selected') return SELECTED_POSE
  throw new Error(`unknown mark frame ${frame}`)
}

/** Idle/selected bake eyes into the PNG. Body is eyeless so the rail can overlay dots. */
export function eyeLookForName(frame: MarkFrame): EyeLook {
  if (frame === 'body') return { dx: 0, dy: 0, open: 0 }
  if (frame === 'rest') return { dx: 0, dy: 0, open: 1 }
  if (frame === 'breathe') return { dx: 0.01, dy: -0.015, open: 1 }
  if (frame === 'selected') return { dx: -0.03, dy: 0.01, open: 1 }
  throw new Error(`unknown mark frame ${frame}`)
}

export function allFrameNames(): MarkFrame[] {
  return ['rest', 'breathe', 'selected', 'body']
}

export const MARK_FRAMES = allFrameNames()

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return [
    uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
    uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1],
  ]
}

function parseHead(steps = 28): Pt[] {
  const tokens = HEAD.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!tokens) throw new Error('HEAD path failed to parse')
  const pts: Pt[] = []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const take = () => Number(tokens[i++])
  while (i < tokens.length) {
    const raw = tokens[i]
    if (/^[MLCZ]$/i.test(raw)) {
      cmd = raw.toUpperCase()
      i += 1
      if (cmd === 'Z') {
        pts.push([sx, sy])
        break
      }
      continue
    }
    if (cmd === 'M') {
      x = take()
      y = take()
      sx = x
      sy = y
      pts.push([x, y])
      cmd = 'L'
    } else if (cmd === 'C') {
      const x1 = take()
      const y1 = take()
      const x2 = take()
      const y2 = take()
      const x3 = take()
      const y3 = take()
      for (let s = 1; s <= steps; s++) pts.push(cubic([x, y], [x1, y1], [x2, y2], [x3, y3], s / steps))
      x = x3
      y = y3
    } else {
      throw new Error(`unexpected HEAD command ${cmd}`)
    }
  }
  return pts
}

function regularPoly(radius: number, n: number, rot: number): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const verts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n
    verts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
  }
  return verts
}

function filletPoly(verts: Pt[], radius: number, arcSteps = 7): Pt[] {
  const n = verts.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]
    const curr = verts[i]
    const next = verts[(i + 1) % n]
    const inX = curr[0] - prev[0]
    const inY = curr[1] - prev[1]
    const outX = next[0] - curr[0]
    const outY = next[1] - curr[1]
    const lenIn = Math.hypot(inX, inY)
    const lenOut = Math.hypot(outX, outY)
    const uIn: Pt = [inX / lenIn, inY / lenIn]
    const uOut: Pt = [outX / lenOut, outY / lenOut]
    const turn = Math.acos(clamp(-(uIn[0] * uOut[0] + uIn[1] * uOut[1]), -1, 1))
    const half = Math.max(turn / 2, 1e-4)
    const dist = radius / Math.tan(half)
    const dIn = Math.min(dist, lenIn / 2.4)
    const dOut = Math.min(dist, lenOut / 2.4)
    const rr = Math.min(radius, dIn * Math.tan(half), dOut * Math.tan(half))
    const p1: Pt = [curr[0] - uIn[0] * dIn, curr[1] - uIn[1] * dIn]
    const p2: Pt = [curr[0] + uOut[0] * dOut, curr[1] + uOut[1] * dOut]
    const cross = uIn[0] * uOut[1] - uIn[1] * uOut[0]
    const sign = cross < 0 ? -1 : 1
    const nIn: Pt = [-uIn[1] * sign, uIn[0] * sign]
    const c: Pt = [p1[0] + nIn[0] * rr, p1[1] + nIn[1] * rr]
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0])
    const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0])
    let da = a2 - a1
    if (sign > 0 && da < 0) da += Math.PI * 2
    if (sign < 0 && da > 0) da -= Math.PI * 2
    for (let s = 0; s <= arcSteps; s++) {
      const t = a1 + (da * s) / arcSteps
      out.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)])
    }
  }
  return out
}

function tabletPoly(halfW: number, halfH: number, steps = 20): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const r = Math.min(halfW, halfH)
  const left = cx - halfW + r
  const right = cx + halfW - r
  const pts: Pt[] = []
  for (let s = 0; s <= steps; s++) {
    const a = Math.PI / 2 + (Math.PI * s) / steps
    pts.push([left + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  for (let s = 0; s <= steps; s++) {
    const a = Math.PI * 1.5 + (Math.PI * s) / steps
    pts.push([right + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  pts.push(pts[0])
  return pts
}

function tabletBalls(halfW: number, halfH: number): Ball[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const r = Math.min(halfW, halfH)
  const left = cx - halfW + r
  const right = cx + halfW - r
  const balls: Ball[] = []
  for (let i = 0; i < 7; i++) {
    const t = i / 6
    balls.push({ x: left + t * (right - left), y: cy, r })
  }
  return balls
}

function pebblePoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const r = 108
  const pts: Pt[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    const rr = r * (1 + 0.075 * Math.sin(3 * a))
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return pts
}

function squirclePoly(): Pt[] {
  const n = 4.2
  const r = 110
  const cx = BOX / 2
  const cy = BOX / 2
  const pts: Pt[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    pts.push([
      cx + r * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
      cy + r * Math.sign(s) * Math.pow(Math.abs(s), 2 / n),
    ])
  }
  return pts
}

function wedgePoly(): Pt[] {
  return filletPoly(
    [
      [BOX / 2, BOX / 2 - 114],
      [BOX / 2 + 108, BOX / 2 + 90],
      [BOX / 2 - 108, BOX / 2 + 90],
    ],
    18,
  )
}

function teardropPoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2 - 18
  const r = 88
  const pts: Pt[] = []
  for (let i = 0; i <= 36; i++) {
    const a = Math.PI + (i / 36) * Math.PI
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  pts.push([cx, cy + r + 60])
  return pts
}

function cloudBalls(): Ball[] {
  const cx = BOX / 2
  const cy = BOX / 2
  return [
    { x: cx - 48, y: cy + 8, r: 52 },
    { x: cx - 8, y: cy - 18, r: 58 },
    { x: cx + 42, y: cy + 4, r: 50 },
    { x: cx + 12, y: cy + 22, r: 44 },
    { x: cx - 28, y: cy + 24, r: 40 },
  ]
}

function ellipsePoly(rx: number, ry: number, steps = 48): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const pts: Pt[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

function roundRectPoly(halfW: number, halfH: number, radius: number): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  return filletPoly(
    [
      [cx - halfW, cy - halfH],
      [cx + halfW, cy - halfH],
      [cx + halfW, cy + halfH],
      [cx - halfW, cy + halfH],
    ],
    radius,
  )
}

function beanPoly(): { poly: Pt[]; balls: Ball[]; union: boolean } {
  const cx = BOX / 2
  const cy = BOX / 2
  const balls: Ball[] = [
    { x: cx - 28, y: cy, r: 78 },
    { x: cx + 42, y: cy + 8, r: 64 },
  ]
  return { poly: hullFromBalls(balls), balls, union: true }
}

function leafPoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  const pts: Pt[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    const rr = 108 * (0.55 + 0.45 * Math.abs(Math.cos(a)))
    pts.push([cx + rr * Math.cos(a) * 0.72, cy + rr * Math.sin(a)])
  }
  return pts
}

function shieldPoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  return filletPoly(
    [
      [cx - 92, cy - 98],
      [cx + 92, cy - 98],
      [cx + 92, cy + 18],
      [cx, cy + 118],
      [cx - 92, cy + 18],
    ],
    16,
  )
}

function domePoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2 + 18
  const r = 110
  const pts: Pt[] = []
  for (let i = 0; i <= 36; i++) {
    const a = Math.PI + (i / 36) * Math.PI
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  pts.push([cx + r, cy + 8], [cx - r, cy + 8])
  return pts
}

function archPoly(): { poly: Pt[]; balls: Ball[]; union: boolean } {
  const cx = BOX / 2
  const cy = BOX / 2
  const balls: Ball[] = [
    { x: cx - 52, y: cy + 28, r: 42 },
    { x: cx + 52, y: cy + 28, r: 42 },
    { x: cx, y: cy - 36, r: 62 },
  ]
  return { poly: hullFromBalls(balls), balls, union: true }
}

function crystalPoly(): Pt[] {
  const cx = BOX / 2
  const cy = BOX / 2
  return filletPoly(
    regularPoly(114, 6, Math.PI / 6).map(([x, y]) => [cx + (x - cx) * 0.72, cy + (y - cy) * 1.12]),
    14,
  )
}

function hullFromBalls(balls: Ball[]): Pt[] {
  const samples: Pt[] = []
  for (const ball of balls) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const x = ball.x + ball.r * Math.cos(a)
      const y = ball.y + ball.r * Math.sin(a)
      const covered = balls.some(
        (other) => other !== ball && Math.hypot(x - other.x, y - other.y) < other.r - 0.5,
      )
      if (!covered) samples.push([x, y])
    }
  }
  let cx = 0
  let cy = 0
  for (const point of samples) {
    cx += point[0]
    cy += point[1]
  }
  cx /= Math.max(samples.length, 1)
  cy /= Math.max(samples.length, 1)
  return samples.sort(
    (left, right) => Math.atan2(left[1] - cy, left[0] - cx) - Math.atan2(right[1] - cy, right[0] - cx),
  )
}

export function shapePoly(shape: MarkShape): { poly: Pt[]; balls: Ball[]; union?: boolean } {
  if (shape === 'blob') return { poly: parseHead(), balls: [] }
  if (shape === 'hex') return { poly: filletPoly(regularPoly(114, 6, Math.PI / 6), 20), balls: [] }
  if (shape === 'tablet') return { poly: tabletPoly(114, 74), balls: tabletBalls(114, 74) }
  if (shape === 'pebble') return { poly: pebblePoly(), balls: [] }
  if (shape === 'squircle') return { poly: squirclePoly(), balls: [] }
  if (shape === 'wedge') return { poly: wedgePoly(), balls: [] }
  if (shape === 'teardrop') return { poly: teardropPoly(), balls: [] }
  if (shape === 'cloud') {
    const balls = cloudBalls()
    return { poly: hullFromBalls(balls), balls, union: true }
  }
  if (shape === 'bean') return beanPoly()
  if (shape === 'egg') return { poly: ellipsePoly(86, 114), balls: [] }
  if (shape === 'capsule') return { poly: tabletPoly(68, 114), balls: tabletBalls(68, 114) }
  if (shape === 'cylinder') return { poly: roundRectPoly(78, 108, 22), balls: [] }
  if (shape === 'gem') return { poly: filletPoly(regularPoly(114, 8, Math.PI / 8), 12), balls: [] }
  if (shape === 'crystal') return { poly: crystalPoly(), balls: [] }
  if (shape === 'shield') return { poly: shieldPoly(), balls: [] }
  if (shape === 'dome') return { poly: domePoly(), balls: [] }
  if (shape === 'arch') return archPoly()
  if (shape === 'leaf') return { poly: leafPoly(), balls: [] }
  return { poly: parseHead(), balls: [] }
}

function winding(x: number, y: number, poly: Pt[]): number {
  let wn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a[1] <= y) {
      if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0) wn += 1
    } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) {
      wn -= 1
    }
  }
  return wn
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1)
  return Math.hypot(px - ax - abx * t, py - ay - aby * t)
}

function distPoly(x: number, y: number, poly: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const d = distSeg(x, y, a[0], a[1], b[0], b[1])
    if (d < best) best = d
  }
  return best
}

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  return [
    Number.parseInt(raw.slice(0, 2), 16) / 255,
    Number.parseInt(raw.slice(2, 4), 16) / 255,
    Number.parseInt(raw.slice(4, 6), 16) / 255,
  ]
}

function crc32(buf: Uint8Array): number {
  let table = crc32.table
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    crc32.table = table
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
crc32.table = undefined as Uint32Array | undefined

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBuf = Buffer.from(type)
  const body = Buffer.concat([typeBuf, Buffer.from(data)])
  const crc = crc32(body)
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc, 8 + data.length)
  return out
}

export function encodePng(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const row = size * 4
  const raw = Buffer.alloc((row + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (row + 1)] = 0
    raw.set(rgba.subarray(y * row, y * row + row), y * (row + 1) + 1)
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ])
}

function mapPoly(poly: Pt[], squashY: number, size: number) {
  let cx = 0
  let cy = 0
  for (const p of poly) {
    cx += p[0]
    cy += p[1]
  }
  cx /= poly.length
  cy /= poly.length
  const squashed = poly.map(([x, y]) => [x, cy + (y - cy) * squashY] as Pt)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of squashed) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const pad = size * 0.08
  const s = Math.min((size - 2 * pad) / Math.max(maxX - minX, 1), (size - 2 * pad) / Math.max(maxY - minY, 1))
  const ox = (size - s * (maxX - minX)) / 2 - minX * s
  const oy = (size - s * (maxY - minY)) / 2 - minY * s
  const pts = squashed.map(([x, y]) => [x * s + ox, y * s + oy] as Pt)
  return { pts, s, ox, oy, cy, squashY }
}

function polyBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function snapInside(occ: Float32Array, size: number, x: number, y: number): Pt {
  const ix = clamp(Math.round(x), 0, size - 1)
  const iy = clamp(Math.round(y), 0, size - 1)
  if (occ[iy * size + ix] >= 0.6) return [x, y]
  let bestX = ix
  let bestY = iy
  let best = Infinity
  for (let yy = 0; yy < size; yy++) {
    for (let xx = 0; xx < size; xx++) {
      if (occ[yy * size + xx] < 0.6) continue
      const dx = xx - x
      const dy = yy - y
      const d = dx * dx + dy * dy
      if (d < best) {
        best = d
        bestX = xx
        bestY = yy
      }
    }
  }
  return [bestX, bestY]
}

function stampEyes(
  rgba: Uint8Array,
  occ: Float32Array,
  pts: Pt[],
  size: number,
  frame: MarkFrame,
): void {
  const look = eyeLookForName(frame)
  if (look.open <= 0) return
  const box = polyBounds(pts)
  const w = Math.max(box.maxX - box.minX, 1)
  const h = Math.max(box.maxY - box.minY, 1)
  const [cx, cy] = snapInside(occ, size, box.minX + w * (0.58 + look.dx), box.minY + h * (0.36 + look.dy))
  const gap = w * 0.22
  const rad = Math.max(2.8, h * 0.072) * look.open
  const pair: Pt[] = [
    snapInside(occ, size, cx - gap / 2, cy),
    snapInside(occ, size, cx + gap / 2, cy),
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (occ[i] < 0.45) continue
      let hit = false
      for (const [ex, ey] of pair) {
        if (Math.hypot(x + 0.5 - ex, y + 0.5 - ey) <= rad) {
          hit = true
          break
        }
      }
      if (!hit) continue
      const o = y * size * 4 + x * 4
      rgba[o] = 0
      rgba[o + 1] = 0
      rgba[o + 2] = 0
      rgba[o + 3] = Math.round(occ[i] * 255)
    }
  }
}

export function blackInkCentroid(rgba: Uint8Array, size: number): { x: number; y: number; n: number } {
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      if (rgba[o + 3] < 200) continue
      if (rgba[o] + rgba[o + 1] + rgba[o + 2] > 36) continue
      sx += x
      sy += y
      n += 1
    }
  }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0, n }
}

export function bakeFrame(shape: MarkShape, tintHex: string, frame: MarkFrame, size = BAKE_SIZE): Uint8Array {
  const pose = poseForName(frame)
  const { poly, balls, union } = shapePoly(shape)
  const mapped = mapPoly(poly, pose.squashY, size)
  const mappedBalls = balls.map((b) => ({
    x: b.x * mapped.s + mapped.ox,
    y: (mapped.cy + (b.y - mapped.cy) * mapped.squashY) * mapped.s + mapped.oy,
    r: b.r * mapped.s * ((1 + mapped.squashY) / 2),
  }))
  const occ = new Float32Array(size * size)
  const height = new Float32Array(size * size)
  let maxH = 1e-6
  const samples: Pt[] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0
      for (const [ox, oy] of samples) {
        const px = x + ox
        const py = y + oy
        let hit = winding(px, py, mapped.pts) !== 0
        if (!hit && union) {
          hit = mappedBalls.some((b) => Math.hypot(px - b.x, py - b.y) < b.r)
        }
        if (hit) cover += 1
      }
      const a = cover / samples.length
      occ[y * size + x] = a
      if (a <= 0) continue
      const d = distPoly(x + 0.5, y + 0.5, mapped.pts)
      let h = d
      if (mappedBalls.length) {
        let ball = 0
        for (const b of mappedBalls) {
          const dx = x + 0.5 - b.x
          const dy = y + 0.5 - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < b.r * b.r) ball = Math.max(ball, Math.sqrt(b.r * b.r - d2))
        }
        h = Math.max(h, ball)
      }
      height[y * size + x] = h
      if (h > maxH) maxH = h
    }
  }
  for (let i = 0; i < height.length; i++) height[i] /= maxH

  const [tr, tg, tb] = parseHex(tintHex)
  const lx = pose.key[0]
  const ly = pose.key[1]
  const lz = pose.keyZ
  const llen = Math.hypot(lx, ly, lz) || 1
  const Lx = lx / llen
  const Ly = ly / llen
  const Lz = lz / llen
  const Hx = Lx
  const Hy = Ly
  const Hz = Lz + 1
  const hlen = Math.hypot(Hx, Hy, Hz) || 1
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const a = occ[i]
      if (a <= 0) continue
      const h = height[i]
      const xm = x > 0 ? height[i - 1] : h
      const xp = x + 1 < size ? height[i + 1] : h
      const ym = y > 0 ? height[i - size] : h
      const yp = y + 1 < size ? height[i + size] : h
      let nx = xm - xp
      let ny = ym - yp
      let nz = 0.55
      const nlen = Math.hypot(nx, ny, nz) || 1
      nx /= nlen
      ny /= nlen
      nz /= nlen
      const ndl = Math.max(0, nx * Lx + ny * Ly + nz * Lz)
      const ndh = Math.max(0, nx * (Hx / hlen) + ny * (Hy / hlen) + nz * (Hz / hlen))
      const spec = pose.spec * 0.18 * ndh ** pose.shine
      const rim = Math.max(0, -(nx * Lx + ny * Ly + nz * Lz)) * 0.05
      const foot = (y / (size - 1)) ** 1.6
      const tilt = clamp(1 - 1.9 * (0.22 * foot - 0.08), 0.15, 1)
      const contact = 0.97 + 0.03 * tilt * (0.5 + 0.5 * h)
      const lambert = 0.94 + 0.06 * ndl
      let r = tr * lambert * contact + spec + rim * 0.45
      let g = tg * lambert * contact + spec + rim * 0.55
      let b = tb * lambert * contact + spec + rim * 0.7
      r = clamp(r, 0, 1)
      g = clamp(g, 0, 1)
      b = clamp(b, 0, 1)
      const o = y * size * 4 + x * 4
      rgba[o] = Math.round(r * 255)
      rgba[o + 1] = Math.round(g * 255)
      rgba[o + 2] = Math.round(b * 255)
      rgba[o + 3] = Math.round(a * 255)
    }
  }
  stampEyes(rgba, occ, mapped.pts, size, frame)
  return rgba
}

export function framePath(root: string, shape: MarkShape, tint: string, frame: MarkFrame): string {
  return join(root, shape, tint, `${frame}.png`)
}

export function writeFrame(root: string, shape: MarkShape, tint: string, hex: string, frame: MarkFrame): string {
  const dest = framePath(root, shape, tint, frame)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, encodePng(BAKE_SIZE, bakeFrame(shape, hex, frame)))
  return dest
}

export function bakeSeedTrio(root: string): string[] {
  const written: string[] = []
  const keep = new Set(allFrameNames().map((frame) => `${frame}.png`))
  for (const seed of SEED_BAKES) {
    const dir = join(root, seed.shape, seed.tint)
    mkdirSync(dir, { recursive: true })
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!keep.has(name)) unlinkSync(join(dir, name))
      }
    }
    for (const frame of allFrameNames()) {
      written.push(writeFrame(root, seed.shape, seed.tint, seed.hex, frame))
    }
  }
  return written
}

export function occupancyAt(shape: MarkShape, x: number, y: number): number {
  const { poly, balls, union } = shapePoly(shape)
  const mapped = mapPoly(poly, 1, BAKE_SIZE)
  if (winding(x, y, mapped.pts) !== 0) return 1
  if (union) {
    const mappedBalls = balls.map((b) => ({
      x: b.x * mapped.s + mapped.ox,
      y: (mapped.cy + (b.y - mapped.cy) * mapped.squashY) * mapped.s + mapped.oy,
      r: b.r * mapped.s * ((1 + mapped.squashY) / 2),
    }))
    if (mappedBalls.some((b) => Math.hypot(x - b.x, y - b.y) < b.r)) return 1
  }
  return 0
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'marks')
  const written = bakeSeedTrio(root)
  console.log(`baked ${written.length} frames under ${root}`)
}
