import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { crc32 } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { T } from '../src/tokens'

const ROOT = join(import.meta.dir, '..')
const PAPER = hex(T.inverse)
const INK = hex(T.brand.ink)

function hex(value: string): [number, number, number] {
  const raw = value.replace('#', '')
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)]
}

function png(pixels: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), row + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]
  return Buffer.concat(chunks)
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([name, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}

function paintMark(size: number, plate: boolean): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  const s = size / 64
  const stroke = (width: number, fn: (x: number, y: number) => number) => {
    const hw = width / 2
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (fn(x / s, y / s) <= hw) set(pixels, size, x, y, PAPER, 255)
      }
    }
  }
  if (plate) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = INK[0]
      pixels[i + 1] = INK[1]
      pixels[i + 2] = INK[2]
      pixels[i + 3] = 255
    }
  }
  fillRounded(pixels, size, s, 10, 14, 44, 8, 4)
  stroke(2, (x, y) => Math.min(seg(x, y, 18, 22, 18, 46), seg(x, y, 32, 22, 32, 50), seg(x, y, 46, 22, 46, 46)))
  fillCircle(pixels, size, s, 18, 48, 3.2)
  fillCircle(pixels, size, s, 32, 52, 3.2)
  fillCircle(pixels, size, s, 46, 48, 3.2)
  return pixels
}

function fillCircle(pixels: Uint8Array, size: number, s: number, cx: number, cy: number, r: number) {
  const ox = cx * s
  const oy = cy * s
  const rr = r * s
  const x0 = Math.max(0, Math.floor(ox - rr - 1))
  const x1 = Math.min(size - 1, Math.ceil(ox + rr + 1))
  const y0 = Math.max(0, Math.floor(oy - rr - 1))
  const y1 = Math.min(size - 1, Math.ceil(oy + rr + 1))
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (Math.hypot(x - ox, y - oy) <= rr) set(pixels, size, x, y, PAPER, 255)
    }
  }
}

function set(pixels: Uint8Array, size: number, x: number, y: number, rgb: [number, number, number], a: number) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (y * size + x) * 4
  pixels[i] = rgb[0]
  pixels[i + 1] = rgb[1]
  pixels[i + 2] = rgb[2]
  pixels[i + 3] = a
}

function fillRounded(
  pixels: Uint8Array,
  size: number,
  s: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const x0 = x * s
  const y0 = y * s
  const x1 = (x + w) * s
  const y1 = (y + h) * s
  const rad = r * s
  for (let py = Math.floor(y0); py < y1; py += 1) {
    for (let px = Math.floor(x0); px < x1; px += 1) {
      const dx = px < x0 + rad ? x0 + rad - px : px > x1 - rad ? px - (x1 - rad) : 0
      const dy = py < y0 + rad ? y0 + rad - py : py > y1 - rad ? py - (y1 - rad) : 0
      if (dx * dx + dy * dy <= rad * rad + 0.5) set(pixels, size, px, py, PAPER, 255)
    }
  }
}

function seg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function writePng(path: string, pixels: Uint8Array, size: number) {
  writeFileSync(path, png(pixels, size, size))
}

const brand = join(ROOT, 'brand')
mkdirSync(brand, { recursive: true })
writePng(join(brand, 'mark.png'), paintMark(256, false), 256)
writePng(join(brand, 'app-icon.png'), paintMark(1024, true), 1024)

const resources = join(ROOT, 'macos', 'Automaton.app', 'Contents', 'Resources')
mkdirSync(resources, { recursive: true })
const iconset = join(ROOT, 'brand', 'AppIcon.iconset')
mkdirSync(iconset, { recursive: true })
const src = join(brand, 'app-icon.png')
if (process.platform === 'darwin') {
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ] as const
  for (const [edge, name] of sizes) {
    spawnSync('sips', ['-z', String(edge), String(edge), src, '--out', join(iconset, name)], { stdio: 'inherit' })
  }
  spawnSync('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'AppIcon.icns')], { stdio: 'inherit' })
}

console.log(`brand baked ${join(brand, 'app-icon.png')}`)
