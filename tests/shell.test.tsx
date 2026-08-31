import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import React from 'react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, Composer, Feed } from '../src/app'
import { UpdateModal } from '../src/update-modal'
import { assertSeedFrames, blobClock, blobDoubleBlink, blobNeedsClock, BUSY_LOOKS, busyEyeLayout, neighborGlance, nextLook, presentBlob, shapeSvgSource, SisterBlob } from '../src/blob'
import {
  DEFAULT_AGENTS,
  emptyThreads,
  createPendingSendView,
  mergePendingFeed,
  pendingSendItems,
  resetIdsForTests,
  staffWithSisters,
  type FeedItem,
} from '../src/domain'
import { Inspector, copyChord, cutChord, inspectorChord, pasteChord, quitChord, selectAllChord } from '../src/inspector'
import { Settings } from '../src/settings'
import { copiedInTests } from '../src/runtime/clipboard'
import { createAgent } from '../src/runtime/factory'
import { readSkin, writeSkin } from '../src/runtime/skin'
import { openStaffStore } from '../src/runtime/store'
import { T } from '../src/tokens'

describe('onSend scheduling', () => {
  test('live Enter presents overlay then commits session after timeout', () => {
    const src = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    const start = src.indexOf('const onSend = () =>')
    const end = src.indexOf('const onAttach = () =>')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const onSend = src.slice(start, end)
    expect(onSend).toContain('flushSync')
    expect(onSend).toContain('presentOverlayFrame')
    expect(onSend).toContain('setPendingSend')
    expect(onSend).toMatch(/finishSend\(paintSend/)
    expect(onSend).toContain('createPendingSendView')
    expect(onSend).toContain('userItemId')
    expect(onSend).toContain('ackItemId')
    expect(onSend).not.toContain('feed-pending-user')
    expect(onSend).toMatch(/setTimeout\(/)
    expect(onSend).not.toContain('queueMicrotask')
    expect(onSend).not.toMatch(/finishSend\(current\)\)\s*finish\(\)/)
    expect(src).toContain('runningTests() ? seeded')
    expect(onSend).toContain('runningTests()')
    expect(onSend).toContain('shouldQueueSteer')
  })

  test('Feed bubbles do not enter from opacity 0', () => {
    const src = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    const start = src.indexOf('export const Feed')
    const end = src.indexOf('function GoalBlockerPanel')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const feed = src.slice(start, end)
    expect(feed).not.toContain('initial={{ opacity: 0 }}')
    expect(feed).not.toMatch(/initial=\{\{\s*opacity:\s*0/)
  })
})

describe('app chords', () => {
  test('cmd+q and cmd+w quit; inspector stays cmd+shift+i', () => {
    expect(quitChord({ key: 'q', modifiers: { cmd: true } })).toBe(true)
    expect(quitChord({ key: 'w', modifiers: { cmd: true } })).toBe(true)
    expect(quitChord({ key: 'q', modifiers: { cmd: true, shift: true } })).toBe(false)
    expect(pasteChord({ key: 'v', modifiers: { cmd: true } })).toBe(true)
    expect(pasteChord({ key: 'v', modifiers: { cmd: true, shift: true } })).toBe(false)
    expect(copyChord({ key: 'c', modifiers: { cmd: true } })).toBe(true)
    expect(selectAllChord({ key: 'a', modifiers: { cmd: true } })).toBe(true)
    expect(cutChord({ key: 'x', modifiers: { cmd: true } })).toBe(true)
    expect(copyChord({ key: 'c', modifiers: { cmd: true, shift: true } })).toBe(false)
    expect(inspectorChord({ key: 'i', modifiers: { cmd: true, shift: true } })).toBe(true)
  })
})

const native = hasNativeTestRenderer ? describe : describe.skip

type TreeNode = {
  type?: string
  text?: string
  id?: number
  testId?: string
  customProps?: { testId?: string }
  bounds?: { x: number; y: number; width: number; height: number }
  children?: TreeNode[]
}

function asTree(raw: unknown): TreeNode | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { tree?: TreeNode } & TreeNode
  return row.tree ?? row
}

function findTestIdPrefix(node: TreeNode | null, prefix: string): TreeNode | null {
  if (!node) return null
  const id = node.testId ?? node.customProps?.testId
  if (id?.startsWith(prefix)) return node
  for (const child of node.children ?? []) {
    const found = findTestIdPrefix(child, prefix)
    if (found) return found
  }
  return null
}

function findTestId(node: TreeNode | null, testId: string): TreeNode | null {
  if (!node) return null
  if (node.testId === testId || node.customProps?.testId === testId) return node
  for (const child of node.children ?? []) {
    const found = findTestId(child, testId)
    if (found) return found
  }
  return null
}

function findAllTestIds(node: TreeNode | null, testId: string, acc: TreeNode[] = []): TreeNode[] {
  if (!node) return acc
  if (node.testId === testId || node.customProps?.testId === testId) acc.push(node)
  for (const child of node.children ?? []) findAllTestIds(child, testId, acc)
  return acc
}

function boundsOf(node: TreeNode | null, renderer: ReturnType<typeof createTestRoot>['renderer']) {
  const bounds =
    node?.bounds ??
    (typeof node?.id === 'number'
      ? (() => {
          const box = renderer.getElementBounds(node.id)
          return box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : null
        })()
      : null)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('no painted bounds')
  return bounds
}

function containsTestId(node: TreeNode | null, testId: string): boolean {
  return Boolean(findTestId(node, testId))
}

function boundsFor(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
): { x: number; y: number; width: number; height: number } {
  renderer.flush()
  const tree = asTree(JSON.parse(renderer.getAutomationTree()))
  const node = findTestId(tree, testId)
  const bounds =
    node?.bounds ??
    (typeof node?.id === 'number'
      ? (() => {
          const box = renderer.getElementBounds(node.id)
          return box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : null
        })()
      : null)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`no painted bounds for ${testId}`)
  }
  return bounds
}

function clickTestId(renderer: ReturnType<typeof createTestRoot>['renderer'], testId: string) {
  const bounds = boundsFor(renderer, testId)
  renderer.nativeSimulateClick(
    Math.floor(bounds.x + Math.min(40, bounds.width / 2)),
    Math.floor(bounds.y + bounds.height / 2),
  )
}

function rightClickTestId(renderer: ReturnType<typeof createTestRoot>['renderer'], testId: string) {
  const bounds = boundsFor(renderer, testId)
  renderer.nativeSimulateMouseDown(
    Math.floor(bounds.x + Math.min(40, bounds.width / 2)),
    Math.floor(bounds.y + bounds.height / 2),
    2,
  )
}

function collectOversized(node: TreeNode | null, max: number, acc: string[] = []): string[] {
  if (!node) return acc
  if (node.bounds && (node.bounds.width > max || node.bounds.height > max)) {
    acc.push(`${node.testId ?? node.type ?? '?'} ${Math.round(node.bounds.width)}x${Math.round(node.bounds.height)}`)
  }
  for (const child of node.children ?? []) collectOversized(child, max, acc)
  return acc
}

function testStore() {
  const home = join(tmpdir(), `automaton-shell-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  process.env.AUTOMATON_HOME = home
  process.env.AUTOMATON_SILENT_PICK = '1'
  return openStaffStore(join(home, 'staff.sqlite'))
}

function longFeed(agentId: string, count: number, prefix = 'line'): FeedItem[] {
  const items: FeedItem[] = []
  for (let i = 0; i < count; i += 1) {
    items.push({
      kind: 'msg',
      id: `${agentId}_${i}`,
      from: i % 2 === 0 ? 'user' : 'agent',
      agentId,
      text: `${prefix} line ${i} of a long thread that should pin the tail`,
    })
  }
  return items
}

function nodeTexts(node: TreeNode | null, acc: string[] = []): string[] {
  if (!node) return acc
  if (typeof node.text === 'string' && node.text.length > 0) acc.push(node.text)
  for (const child of node.children ?? []) nodeTexts(child, acc)
  return acc
}

function feedOffset(renderer: ReturnType<typeof createTestRoot>['renderer']) {
  const tree = asTree(JSON.parse(renderer.getAutomationTree()))
  const feed = findTestId(tree, 'feed')
  return typeof feed?.id === 'number' ? renderer.getScrollOffset(feed.id) : null
}

describe('sister blob presentation', () => {
  test('seed trio frames exist and the glyph source is not a fill chip', () => {
    assertSeedFrames()
    const src = readFileSync(join(import.meta.dir, '../src/blob.tsx'), 'utf8')
    expect(src).not.toMatch(/tickMs|splitCycle|cycleLayers|chewSide|chewMs/)
    expect(src).toMatch(/pointerEvents:\s*'none'/)
    expect(src).toMatch(/type: 'spring'/)
    expect(src).toMatch(/grok|speciesForShape|grokbot/)
    expect(src).toMatch(/shapeSvgSource/)
    expect(src).toMatch(/source=\{svg\}/)
    expect(src).toMatch(/busyEyeLayout/)
    expect(src).toMatch(/T\.catalog\.black/)
    expect(src).not.toMatch(/setPhase\(/)
    expect(src).not.toMatch(/now \/ 80/)
    expect(src).not.toMatch(/lastTick < 50/)
    expect(src).toMatch(/blobClock/)
    expect(src).not.toMatch(/inflatePx|WASH_INFLATE|washHex|washSvg/)
    expect(src).not.toMatch(/left:\s*origin/)
    expect(src).not.toContain('T.blob.size * scale')
    const app = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    expect(app).not.toMatch(/selected \? T.overlayStrong : T.clear/)
    expect(app).not.toMatch(/selected \? T.raised : T.clear/)
    expect(app).toMatch(/pointerEvents: 'auto'/)
    expect(app).not.toMatch(/String\(row\.unread\)/)
  })

  test('selected lifts, idle breathes, and eyes live on every sister', () => {
    const idle = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      index: 0,
      entered: true,
    })
    const selected = presentBlob({
      selected: true,
      unread: 0,
      mouthBusy: false,
      index: 0,
      entered: true,
    })
    const unread = presentBlob({
      selected: false,
      unread: 2,
      mouthBusy: false,
      index: 2,
      entered: true,
    })
    const busy = presentBlob({
      selected: true,
      unread: 1,
      mouthBusy: true,
      index: 1,
      entered: true,
    })
    const busyIdleSeat = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: true,
      index: 0,
      entered: true,
    })
    expect(idle.weights).toEqual({ rest: 1, breathe: 0, selected: 0, body: 0 })
    expect(idle.glyphHeight).toBe(T.blob.size)
    expect(idle.lift).toBe(0)
    expect(blobNeedsClock(false)).toBe(true)
    expect(selected.weights).toEqual({ rest: 0, breathe: 0, selected: 1, body: 0 })
    expect(selected.lift).toBe(0)
    expect(selected.duration).toBe(T.motion.selected)
    expect(blobNeedsClock(true)).toBe(true)
    expect(unread.weights.rest).toBe(1)
    expect(unread.weights.body).toBe(0)
    expect(busy.weights).toEqual({ rest: 0, breathe: 0, selected: 0, body: 1 })
    expect(busy.duration).toBe(T.motion.selected)
    expect(busy.glyphHeight).toBe(T.blob.size)
    expect(busy.lift).toBe(0)
    expect(busyIdleSeat.weights.body).toBe(1)
    expect(busyIdleSeat.weights.rest).toBe(0)
    expect(blobNeedsClock(true)).toBe(true)
    const open = busyEyeLayout(0, false)
    const shut = busyEyeLayout(0, true)
    const glance = busyEyeLayout(1, false)
    expect(open).toHaveLength(2)
    expect(open[0]?.height).toBe(T.blob.eye)
    expect(shut[0]?.height).toBe(T.space.xxs)
    expect(shut[0]?.height).toBeLessThan(open[0]?.height ?? 0)
    expect(Math.abs((glance[0]?.left ?? 0) - (open[0]?.left ?? 0))).toBeGreaterThan(0)
    expect(T.blob.size).toBe(38)
    expect(T.blob.slot).toBe(46)
    expect(T.blob.enterSize).toBe(28)
    expect(T.blob.selectedLift).toBe(-3)
    expect(T.blob.eye).toBe(4)
    expect(T.blob.eyeGap).toBe(7)
    expect(T.blob.eyeX).toBe(22)
    expect(T.blob.eyeY).toBe(14)
    expect(T.blob.eyeWander).toBe(4)
    const stamped = shapeSvgSource('blob', '#000000', T.blob.size)
    expect(stamped).toContain('width="38"')
    expect(stamped).toContain('height="38"')
    expect(stamped).toContain('viewBox="-15 -15 259 259"')
    expect(stamped).toContain('fill="#000000"')
    expect(stamped).toContain('overflow="hidden"')
    expect(stamped).not.toContain('stroke-width')
    const tinted = shapeSvgSource('blob', '#00C972', T.blob.size)
    expect(tinted).not.toContain('stroke-width')
    expect(tinted).toContain('fill="#00C972"')
    expect(tinted).toContain('overflow="hidden"')
    expect(tinted).toContain('width="38"')
    const blobSrc = readFileSync(join(import.meta.dir, '../src/blob.tsx'), 'utf8')
    expect(blobSrc).toMatch(/svgStampStyle/)
    expect(blobSrc).toMatch(/color:\s*tint/)
    expect(blobSrc).toMatch(/svgStampStyle\(T\.catalog\.black/)
    expect(blobSrc).toMatch(/backgroundColor:\s*T\.selected/)
    expect(blobSrc).toMatch(/borderRadius:\s*PLATE_RADIUS/)
    expect(blobSrc).toMatch(/style\.color/)
    expect(blobSrc).not.toMatch(/left:\s*origin,\s*top:\s*origin/)
    expect(blobSrc).not.toContain('T.blob.size * scale')
    expect(blobSrc).not.toMatch(/animate=\{\{\s*width:\s*size,\s*height:\s*size/)
    expect(blobSrc).toMatch(/GELATIN/)
    expect(blobSrc).toMatch(/GELATIN\.stiffness/)
    expect(blobSrc).not.toMatch(/LIQUID/)
    expect(blobSrc).not.toMatch(/IDLE_TURNS/)
    expect(blobSrc).toMatch(/stiffness: 18/)
    expect(blobSrc).toMatch(/damping: 7/)
    expect(blobSrc).toMatch(/mass: 1\.0/)
    expect(blobSrc).not.toMatch(/hover:\s*\{\s*opacity:\s*T\.blob\.hover/)
    expect(blobSrc).not.toMatch(/onFrame/)
    expect(blobSrc).toMatch(/nextLook/)
    expect(blobSrc).toMatch(/blobDoubleBlink/)
    expect(blobSrc).not.toMatch(/idleTurn/)
    expect(blobSrc).not.toMatch(/socialGlance/)
    expect(blobSrc).not.toMatch(/setInflatePx/)
    expect(blobSrc).not.toMatch(/FAT_INFLATE_PX/)
    expect(blobSrc).not.toMatch(/SLOW_INFLATE_PX/)
    expect(blobSrc).not.toMatch(/LIFE_TARGET_MS/)
    expect(blobSrc).not.toMatch(/WASH_INFLATE/)
    expect(blobSrc).toMatch(/opacity:\s*1/)
    expect(blobSrc).toMatch(/ellipse/)
    expect(blobSrc).toMatch(/eyeSvgSource/)
    expect(blobSrc).not.toMatch(/backgroundColor: T\.catalog\.black/)
    expect(blobSrc).toMatch(/Math\.round/)
    expect(T.blob.hover).toBe(0.92)
    expect(T.blob.active).toBe(0.8)
  })


  test('each sister seeds its own clock from id, not a shared phase', () => {
    const staff = blobClock('staff')
    const kernel = blobClock('kernel')
    const research = blobClock('research')
    expect(staff.phaseOffset).not.toBe(kernel.phaseOffset)
    expect(kernel.phaseOffset).not.toBe(research.phaseOffset)
    expect(staff.breathePeriod).not.toBe(kernel.breathePeriod)
    expect(staff.wanderMs).not.toBe(kernel.wanderMs)
    expect(staff.blinkEveryMs).not.toBe(kernel.blinkEveryMs)
    expect(staff.blinkDelayMs).not.toBe(kernel.blinkDelayMs)
    expect(staff.breathePeriod).toBeGreaterThanOrEqual(T.blob.breatheMs * 0.75)
    expect(staff.breathePeriod).toBeLessThanOrEqual(T.blob.breatheMs * 1.3)
    expect('turnPeriodMs' in staff).toBe(false)
    expect('turnStart' in staff).toBe(false)
    expect('wanderSkipMod' in staff).toBe(false)
    expect(blobClock('staff')).toEqual(staff)
  })

  test('gelatin springs, five looks, and no idle ellipse squash', () => {
    expect(BUSY_LOOKS).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: -0.55 },
      { x: -0.85, y: 0.35 },
      { x: 0.45, y: 0.75 },
      { x: -1, y: -0.25 },
    ])
    expect(BUSY_LOOKS).toHaveLength(5)
    const src = readFileSync(join(import.meta.dir, '../src/blob.tsx'), 'utf8')
    expect(src).toMatch(/from '@gpuix\/react'/)
    expect(src).toMatch(/GELATIN/)
    expect(src).toMatch(/GELATIN\.stiffness/)
    expect(src).toMatch(/GELATIN\.damping/)
    expect(src).toMatch(/GELATIN\.mass/)
    expect(src).not.toMatch(/IDLE_TURNS/)
    expect(src).not.toMatch(/LIQUID/)
    expect(src).not.toMatch(/idleTurn/)
    expect(src).not.toMatch(/socialGlance/)
    expect(src).not.toMatch(/SocialEyes/)
    expect(src).not.toMatch(/turnPeriodMs/)
    expect(src).not.toMatch(/wanderSkipMod/)
    expect(src).toMatch(/stiffness: 18/)
    expect(src).toMatch(/damping: 7/)
    expect(src).toMatch(/mass: 1\.0/)
    expect(src).toMatch(/pointer\.down/)
    expect(src).toMatch(/delay: side \* 0\.05/)
    expect(src).not.toMatch(/style\.hover/)
    expect(src).not.toMatch(/hover: \{ opacity: T\.blob\.hover \}/)
    expect(src).toMatch(/setBlink\(true\)/)
    expect(src).toMatch(/height: px\(eye\.height\)/)
    expect(src).not.toMatch(/onFrame\(/)
    const steps = Array.from({ length: 24 }, (_, i) => nextLook('kernel', i) - i)
    expect(steps.some((delta) => delta >= 2)).toBe(true)
    expect(steps.some((delta) => delta === 1)).toBe(true)
    const doubles = Array.from({ length: 20 }, (_, i) => blobDoubleBlink('staff', i))
    expect(doubles.some(Boolean)).toBe(true)
    expect(doubles.some((v) => !v)).toBe(true)
    const glances = Array.from({ length: 40 }, (_, i) => neighborGlance('kernel', i, 2))
    expect(glances.filter((g) => g.x === 0 && g.y === 0).length).toBeGreaterThan(24)
    expect(glances.some((g) => g.y < 0)).toBe(true)
    expect(glances.some((g) => g.y > 0)).toBe(true)
    expect(glances.every((g) => g.x === 0)).toBe(true)
    expect(src).toMatch(/neighborGlance/)
    expect(src).toMatch(/FrozenMark/)
    const app = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    expect(app).not.toMatch(/neighborSelected/)
    expect(app).not.toMatch(/railCount=\{agents\.length\}/)
  })

  test('a job handle is not an input, so it cannot think a mouth', () => {
    const kernel = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      index: 1,
      entered: true,
    })
    expect(kernel.weights.body).toBe(0)
    expect(kernel.weights.rest).toBe(1)
    expect(kernel.duration).not.toBe(T.blob.wanderMs / 1000)
    expect(kernel.glyphWidth).toBe(T.blob.size)
  })

  test('first paint shows the rest frame so the rail is never an empty chip', () => {
    const mount = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      index: 2,
      entered: false,
    })
    expect(mount.weights.rest).toBe(1)
    expect(mount.weights.body).toBe(0)
    expect(mount.glyphWidth).toBe(T.blob.size)
    expect(mount.delay).toBe(2 * T.blob.stagger)
  })
})

native('staff shell (GPUI native)', () => {
  test('rail, empty feed, and Send are painted', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    const shot = 'artifacts/shots/shell-idle.png'
    renderer.captureScreenshot(shot)
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Chief of Staff')
    expect(painted).not.toContain('Kernel')
    expect(painted).not.toContain('Research')
    expect(painted).toContain('Start shipping. No strings attached.')
    expect(painted).toContain('Send')
    expect(painted).toContain('Message this automaton')
    expect(painted).toContain('Settings')
    expect(statSync(shot).size).toBeGreaterThan(1000)
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'titlebar-brand')?.text ?? findTestId(tree, 'titlebar-brand')?.children?.[0]?.text).toBe(
      'Automaton',
    )
    expect(findTestId(tree, 'inspector-pane')?.bounds?.width ?? 0).toBe(0)
    expect(findTestId(tree, 'desk-stage')).toBeFalsy()
    expect(findTestId(tree, 'send')?.text ?? findTestId(tree, 'send')?.children?.[0]?.text).toBe('Send')
    expect(findTestId(tree, 'blob-staff')).toBeTruthy()
    expect(findTestId(tree, 'blob-kernel')).toBeFalsy()
    expect(findTestId(tree, 'blob-research')).toBeFalsy()
    expect(findTestId(tree, 'rail-model-staff')).toBeTruthy()
    expect(findTestId(tree, 'new-agent')).toBeTruthy()
    expect(findTestId(tree, 'feed-empty')).toBeTruthy()
    expect(findTestId(tree, 'attach')).toBeTruthy()
    expect(painted).toContain('New automaton')
    const blob = findTestId(tree, 'blob-staff')
    expect(blob?.bounds?.width ?? 0).toBeLessThanOrEqual(T.blob.slot + 4)
    expect(blob?.bounds?.height ?? 0).toBeLessThanOrEqual(T.blob.slot + 4)
    expect(collectOversized(blob, T.blob.slot + 4)).toEqual([])
    clickTestId(renderer, 'new-agent')
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    const title = findTestId(after, 'titlebar-name')
    expect(title?.text ?? title?.children?.[0]?.text).toBe('New automaton')
    expect(findTestId(after, 'inspector')).toBeTruthy()
    const rail = findTestId(tree, 'rail')
    expect(rail?.bounds?.width ?? 0).toBe(T.layout.sidebarWidth)
    expect(findTestId(tree, 'rail-resize')).toBeTruthy()
  })

  test('compact rail hides names and keeps blobs', () => {
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarMin })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const rail = findTestId(tree, 'rail')
    expect(rail?.bounds?.width ?? 0).toBe(T.layout.sidebarMin)
    expect(findTestId(tree, 'blob-staff')).toBeTruthy()
    expect(findTestId(tree, 'blob-kernel')).toBeFalsy()
    expect(findTestId(tree, 'blob-research')).toBeFalsy()
    expect(findTestId(tree, 'rail-model-staff')).toBeFalsy()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).not.toContain('Kernel')
    expect(painted).not.toContain('Research')
    expect(painted).not.toContain('New automaton')
    expect(painted).not.toContain('Settings')
    expect(findTestId(tree, 'new-agent')).toBeTruthy()
    expect(findTestId(tree, 'settings-open')).toBeTruthy()
    expect(findTestId(tree, 'new-agent-icon')).toBeTruthy()
    expect(findTestId(tree, 'settings-icon')).toBeTruthy()
    const gear = findTestId(tree, 'settings-icon')
    expect(gear?.bounds?.width ?? 0).toBeLessThanOrEqual(T.size.badge)
    expect(gear?.bounds?.height ?? 0).toBeLessThanOrEqual(T.size.badge)
    const appSrc = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    const gearFn = appSrc.split('function GearMark()')[1]?.split('function Rail(')[0] ?? ''
    expect(gearFn).toContain('T.size.badge')
    expect(gearFn).toContain('T.space.xxs')
    expect(gearFn).not.toContain('T.blob.enterSize')
    expect(gearFn).not.toContain('T.blob.size')
    const plusFn = appSrc.split('function PlusMark()')[1]?.split('function GearMark()')[0] ?? ''
    expect(plusFn).toContain('T.blob.enterSize')
  })

  test('rail has no unread count on worker mouths', () => {
    resetIdsForTests()
    writeSkin({ railWidth: T.layout.sidebarWidth })
    const store = testStore()
    const sister = createAgent({ name: 'Kernel' })
    const agents = [...DEFAULT_AGENTS, sister.agent]
    const threads = emptyThreads(agents)
    threads[sister.agent.id] = { ...threads[sister.agent.id], unread: 4 }
    store.save({
      agents,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const row = findTestId(tree, `agent-${sister.agent.id}`)
    expect(row).toBeTruthy()
    expect(nodeTexts(row)).not.toContain('4')
    expect(renderer.getPaintedText().join(' ')).toContain('Kernel')
  })

  test('dragging the rail handle writes a wider skin', () => {
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarWidth })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const before = asTree(JSON.parse(renderer.getAutomationTree()))
    const handle = findTestId(before, 'rail-resize')
    const box =
      handle?.bounds ??
      (typeof handle?.id === 'number'
        ? (() => {
            const raw = renderer.getElementBounds(handle.id)
            return raw ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] } : null
          })()
        : null)
    if (!box || box.width <= 0) throw new Error('no painted bounds for rail-resize')
    const x = Math.floor(box.x + box.width / 2)
    const y = Math.floor(box.y + box.height / 2)
    renderer.nativeSimulateMouseDown(x, y)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'rail-drag')).toBeTruthy()
    expect(renderer.getPaintedText().join(' ')).toContain('Send')
    renderer.nativeSimulateMouseMove(x + 80, y, 0)
    renderer.flush()
    renderer.nativeSimulateMouseUp(x + 80, y)
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    const rail = findTestId(after, 'rail')
    expect(rail?.bounds?.width ?? 0).toBe(T.layout.sidebarWidth + 80)
    expect(readSkin().railWidth).toBe(T.layout.sidebarWidth + 80)
    renderer.nativeSimulateMouseMove(x + 160, y, 0)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'rail')?.bounds?.width ?? 0).toBe(
      T.layout.sidebarWidth + 80,
    )
  })

  test('dragging the rail handle left narrows the rail', () => {
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarWidth })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const before = asTree(JSON.parse(renderer.getAutomationTree()))
    const handle = findTestId(before, 'rail-resize')
    const box =
      handle?.bounds ??
      (typeof handle?.id === 'number'
        ? (() => {
            const raw = renderer.getElementBounds(handle.id)
            return raw ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] } : null
          })()
        : null)
    if (!box || box.width <= 0) throw new Error('no painted bounds for rail-resize')
    const x = Math.floor(box.x + box.width / 2)
    const y = Math.floor(box.y + box.height / 2)
    renderer.nativeSimulateMouseDown(x, y)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'rail-drag')).toBeTruthy()
    renderer.nativeSimulateMouseMove(40, y, 0)
    renderer.flush()
    renderer.nativeSimulateMouseUp(40, y)
    renderer.flush()
    const rail = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'rail')
    expect(rail?.bounds?.width ?? 0).toBe(T.layout.sidebarMin)
    expect(readSkin().railWidth).toBe(T.layout.sidebarMin)
    renderer.nativeSimulateMouseMove(x + 80, y, 0)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'rail')?.bounds?.width ?? 0).toBe(
      T.layout.sidebarMin,
    )
  })

  test('rail resize gutter sits beside the rail, not inside it', () => {
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarWidth })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const rail = findTestId(tree, 'rail')
    const handle = findTestId(tree, 'rail-resize')
    expect(handle?.bounds?.width ?? 0).toBeGreaterThanOrEqual(T.layout.railHandle)
    expect(handle?.bounds?.x ?? 0).toBeGreaterThanOrEqual(
      (rail?.bounds?.x ?? 0) + (rail?.bounds?.width ?? 0) - 2,
    )
    expect(handle?.bounds?.width ?? 0).toBe(T.layout.railHandle)
    const src = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    const drag = src.match(/testId="rail-drag"[\s\S]*?onMouseMove=\{moveRail\}/)?.[0]
    expect(drag).toBeTruthy()
    expect(drag).not.toContain('backgroundColor')
  })

  test('only the mouth-busy sister pulses; a job handle is not mouth busy', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div>
        {staffWithSisters().map((agent, index) => (
          <SisterBlob
            key={agent.id}
            agent={agent}
            selected={agent.id === 'staff'}
            unread={agent.id === 'research' ? 1 : 0}
            mouthBusy={agent.id === 'kernel'}
            index={index}
          />
        ))}
      </div>,
    )
    renderer.flush()
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const staff = findTestId(tree, 'blob-staff')
    const kernel = findTestId(tree, 'blob-kernel')
    const research = findTestId(tree, 'blob-research')
    expect(staff).toBeTruthy()
    expect(kernel).toBeTruthy()
    expect(research).toBeTruthy()
    expect(findTestId(tree, 'blob-eye-kernel-left')).toBeTruthy()
    expect(findTestId(tree, 'blob-eye-kernel-right')).toBeTruthy()
    expect(findTestId(tree, 'blob-eye-staff-left')).toBeTruthy()

    renderer.clockPause()
    renderer.clockFastForward(T.blob.wanderMs)
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(after, 'blob-eye-kernel-left')).toBeTruthy()
    expect(findTestId(after, 'blob-kernel')).toBeTruthy()
    expect(findTestId(after, 'blob-staff')).toBeTruthy()
  })

  test('job strip is gone; composer Stop is the cancel control', () => {
    const { render, renderer } = createTestRoot()
    render(
      <Composer
        value=""
        pendingPaths={[]}
        locked={false}
        stopping
        onChange={() => {}}
        onAttach={() => {}}
        onPaste={() => {}}
        onDropPending={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    expect(findTestId(tree, 'composer-stop')).toBeTruthy()
    expect(findTestId(tree, 'send')).toBeTruthy()
  })

  test('composer Stop chip shows while the mouth turn is live', () => {
    const { render, renderer } = createTestRoot()
    render(
      <Composer
        value=""
        pendingPaths={[]}
        locked={false}
        queueing
        queued={1}
        stopping
        onChange={() => {}}
        onAttach={() => {}}
        onPaste={() => {}}
        onDropPending={() => {}}
        onSend={() => {}}
        onStop={() => {}}
      />,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'composer-stop')).toBeTruthy()
    expect(findTestId(tree, 'send')).toBeTruthy()
  })

  test('pending overlay items pin as user plus Telling without jobs', () => {
    const agents = [
      ...DEFAULT_AGENTS,
      { id: 'agent_mn', name: 'Marionette', title: '', description: '', color: '#777777', hidden: false },
    ]
    resetIdsForTests()
    const overlay = createPendingSendView("What is Marionette's version up to now?", agents, 'staff')
    expect(overlay.userItemId).not.toBe('feed-pending-user')
    expect(overlay.ackItemId).not.toBe('feed-pending-ack')
    expect(pendingSendItems(overlay.text, agents, 'staff').map((item) => item.id)).not.toEqual([
      overlay.userItemId,
      overlay.ackItemId,
    ])
    const items = mergePendingFeed([], overlay, 'staff')
    expect(items.map((item) => item.id)).toEqual([overlay.userItemId, overlay.ackItemId])
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={agents} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'bubble-mine')).toBeTruthy()
    expect(findTestId(tree, 'bubble-theirs')).toBeTruthy()
    expect(findTestId(tree, `msg-${overlay.userItemId}`)).toBeTruthy()
    expect(findTestId(tree, `msg-${overlay.ackItemId}`)).toBeTruthy()
    expect(findTestId(tree, 'feed-pending-user')).toBeFalsy()
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain("What is Marionette's version up to now?")
    expect(painted).toContain('Telling Marionette.')
    const covered = mergePendingFeed(
      [
        { kind: 'msg', id: overlay.userItemId, from: 'user', agentId: 'staff', text: overlay.text },
        { kind: 'msg', id: overlay.ackItemId, from: 'agent', agentId: 'staff', text: overlay.ack },
      ],
      overlay,
      'staff',
    )
    expect(covered.map((item) => item.id)).toEqual([overlay.userItemId, overlay.ackItemId])
  })

  test('Staff feed keeps Sent to and hides the sister line', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: '1', from: 'user', agentId: 'staff', text: 'Can you ping research?' },
      { kind: 'msg', id: '2', from: 'agent', agentId: 'staff', text: 'Asking Research.' },
      { kind: 'relay', id: '3', lane: 'sent', peerId: 'research', text: 'The operator asked if you are around.' },
      {
        kind: 'relay',
        id: '4',
        lane: 'from',
        peerId: 'research',
        text: "I'm here to assist you. How can I help?",
      },
      {
        kind: 'msg',
        id: '5',
        from: 'agent',
        agentId: 'staff',
        text: 'Research is online. What would you like the research automaton to run?',
      },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={staffWithSisters()} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'relay-sent-research')).toBeTruthy()
    expect(findTestId(tree, 'relay-from-research')).toBeNull()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Sent to Research')
    expect(painted).toContain('Research is online')
    expect(painted).not.toContain("I'm here to assist you")
    expect(painted).not.toContain('Message from Research')
  })

  test('feed sticks to the latest line', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 240, display: 'flex', flexDirection: 'column' }}>
        <Feed items={longFeed('staff', 24)} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    const offset = feedOffset(renderer)
    expect(offset).not.toBeNull()
    expect(offset?.[1] ?? 0).toBeLessThan(0)
  })

  test('new lines keep the feed on the tail', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 240, display: 'flex', flexDirection: 'column' }}>
        <Feed items={longFeed('staff', 8)} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    render(
      <div style={{ height: 240, display: 'flex', flexDirection: 'column' }}>
        <Feed items={longFeed('staff', 24)} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    renderer.flush()
    const offset = feedOffset(renderer)
    expect(offset?.[1] ?? 0).toBeLessThan(0)
    expect(renderer.getPaintedText().join(' ')).toContain('line 23')
  })

  test('switching mouths pins the feed to that thread tail', () => {
    resetIdsForTests()
    const store = testStore()
    const sister = createAgent({ name: 'Kernel' })
    const agents = [...DEFAULT_AGENTS, sister.agent]
    const threads = emptyThreads(agents)
    threads.staff = { ...threads.staff, items: longFeed('staff', 24, 'Staff') }
    threads[sister.agent.id] = { ...threads[sister.agent.id], items: longFeed(sister.agent.id, 24, 'Kernel') }
    store.save({
      agents,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    clickTestId(renderer, `agent-${sister.agent.id}`)
    renderer.flush()
    renderer.flush()
    const offset = feedOffset(renderer)
    expect(offset?.[1] ?? 0).toBeLessThan(0)
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Kernel line 23')
    const title = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'titlebar-name')
    expect(title?.text ?? title?.children?.[0]?.text).toBe('Kernel')
  })

  test('running jobs show composer Stop and no job-strip', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const store = testStore()
    const threads = emptyThreads(DEFAULT_AGENTS)
    threads.staff = { ...threads.staff, items: longFeed('staff', 24, 'Staff'), mouth: 'idle' }
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads,
      jobs: [
        {
          id: 'job_strip_overlap',
          ownerAgentId: 'staff',
          goal: 'Ask research, what model and provider are we using right now?',
          status: 'running',
          kind: 'analyze',
        },
        {
          id: 'job_sister',
          ownerAgentId: 'kernel',
          goal: 'check kernel for prs or open issues',
          status: 'running',
          kind: 'analyze',
        },
      ],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    renderer.flush()
    const shot = 'artifacts/shots/shell-job-dock.png'
    renderer.captureScreenshot(shot)
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    expect(findTestId(tree, 'composer-stop')).toBeTruthy()
    expect(findTestId(tree, 'dock')).toBeTruthy()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Staff line 23')
    expect(painted).toContain('Stop')
    expect(statSync(shot).size).toBeGreaterThan(1000)
    clickTestId(renderer, 'composer-stop')
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(after, 'composer-stop')).toBeFalsy()
    expect(findTestId(after, 'job-strip')).toBeFalsy()
  })

  test('goal blocker sits on the dock, not the transcript; Retry and Cancel work', () => {
    resetIdsForTests()
    mkdirSync('artifacts/shots', { recursive: true })
    const blocked = {
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff' as const,
      threads: {
        ...emptyThreads(DEFAULT_AGENTS),
        staff: {
          ...emptyThreads(DEFAULT_AGENTS).staff,
          items: [
            { kind: 'msg' as const, id: 'u1', from: 'user' as const, agentId: 'staff', text: 'merge dest to main' },
            { kind: 'msg' as const, id: 'a1', from: 'agent' as const, agentId: 'staff', text: 'On it.' },
          ],
        },
      },
      jobs: [
        {
          id: 'job_wait',
          ownerAgentId: 'staff',
          goal: 'look at the dest checkout',
          status: 'waiting' as const,
          kind: 'analyze' as const,
          goalId: 'goal_1',
          criterionId: 'crit_1',
        },
      ],
      goals: [
        {
          id: 'goal_1',
          text: 'look at the dest checkout',
          coordinatorId: 'staff',
          ownerAgentId: 'staff',
          criteria: [
            {
              id: 'crit_1',
              label: 'look',
              kind: 'analyze' as const,
              work: 'look at the dest checkout',
              status: 'blocked' as const,
            },
          ],
          receipts: [],
          status: 'waiting_user' as const,
          activeCriterionId: 'crit_1',
          blocker: {
            reason: 'Need a product checkout to land dest.',
            criterionId: 'crit_1',
            jobId: 'job_wait',
            at: 1,
          },
        },
      ],
      pendingFanout: null,
    }
    const retryStore = testStore()
    retryStore.save(blocked)
    const { render, renderer, unmount } = createTestRoot()
    render(<App store={retryStore} />)
    renderer.flush()
    const shot = 'artifacts/shots/shell-goal-blocker.png'
    renderer.captureScreenshot(shot)
    let tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'goal-blocker')).toBeTruthy()
    expect(findTestId(tree, 'goal-blocker-retry')).toBeTruthy()
    expect(findTestId(tree, 'goal-blocker-cancel')).toBeTruthy()
    expect(containsTestId(findTestId(tree, 'feed'), 'goal-blocker')).toBe(false)
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    expect(findTestId(tree, 'composer-stop')).toBeFalsy()
    expect(findTestId(tree, 'composer')).toBeTruthy()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Waiting on you')
    expect(painted).toContain('Need a product checkout to land dest.')
    expect(painted).toContain('Retry')
    expect(painted).toContain('Cancel goal')
    expect(statSync(shot).size).toBeGreaterThan(1000)
    clickTestId(renderer, 'goal-blocker-retry')
    renderer.flush()
    tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'goal-blocker')).toBeFalsy()
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    expect(findTestId(tree, 'composer-stop')).toBeTruthy()
    expect(findTestId(tree, 'composer')).toBeTruthy()
    unmount()

    const cancelStore = testStore()
    cancelStore.save(blocked)
    const cancelRoot = createTestRoot()
    cancelRoot.render(<App store={cancelStore} />)
    cancelRoot.renderer.flush()
    clickTestId(cancelRoot.renderer, 'goal-blocker-cancel')
    cancelRoot.renderer.flush()
    const cancelled = asTree(JSON.parse(cancelRoot.renderer.getAutomationTree()))
    expect(findTestId(cancelled, 'goal-blocker')).toBeFalsy()
    expect(findTestId(cancelled, 'job-strip')).toBeFalsy()
    expect(findTestId(cancelled, 'composer-stop')).toBeFalsy()
    expect(findTestId(cancelled, 'composer')).toBeTruthy()
    expect(containsTestId(findTestId(cancelled, 'feed'), 'goal-blocker')).toBe(false)
  })

  test('desk handoff is a Take control card, not a spoken hint', () => {
    resetIdsForTests()
    const store = testStore()
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads: emptyThreads(DEFAULT_AGENTS),
      jobs: [],
      pendingFanout: null,
      deskHandoff: {
        agentId: 'staff',
        url: 'https://github.com/login',
        instruction: 'Sign in to GitHub.',
      },
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'desk-handoff')).toBeTruthy()
    expect(findTestId(tree, 'desk-handoff-yes')).toBeTruthy()
    expect(findTestId(tree, 'desk-stage')).toBeFalsy()
    expect(renderer.getPaintedText().join(' ')).toContain('Sign in to GitHub.')
    clickTestId(renderer, 'desk-handoff-yes')
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(after, 'desk-handoff')).toBeFalsy()
    expect(findTestId(after, 'desk-stage')).toBeTruthy()
  })

  test('a growing last line stays on the tail', () => {
    const first = longFeed('staff', 8)
    const grown = first.map((item, index) =>
      index === first.length - 1 && item.kind === 'msg'
        ? {
            ...item,
            text: `${item.text} and then the mouth keeps speaking so the tail has to move`,
          }
        : item,
    )
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 240, display: 'flex', flexDirection: 'column' }}>
        <Feed items={first} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    render(
      <div style={{ height: 240, display: 'flex', flexDirection: 'column' }}>
        <Feed items={grown} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    renderer.flush()
    expect(feedOffset(renderer)?.[1] ?? 0).toBeLessThan(0)
    expect(renderer.getPaintedText().join(' ')).toContain('the tail has to move')
  })

  test('titlebar opens inspector and rail Settings paints usage chrome', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    clickTestId(renderer, 'titlebar')
    renderer.flush()
    const inspectorShot = 'artifacts/shots/shell-inspector.png'
    renderer.captureScreenshot(inspectorShot)
    const inspector = renderer.getPaintedText().join(' ')
    expect(inspector).toContain('Inspector')
    expect(inspector).toContain('Coordinator')
    expect(inspector).toContain('Computer')
    expect(inspector).toContain('One local Docker')
    expect(inspector).toContain('Desktop')
    expect(inspector).toContain('No screen yet')
    expect(inspector).toContain('Refresh')
    expect(inspector).toContain("Chief of Staff's screen")
    expect(inspector).toContain('Take control')
    expect(inspector).not.toContain('Last job')
    expect(inspector).toContain('Mark')
    expect(inspector).toContain('Kit')
    expect(inspector).toContain('Rules')
    expect(inspector).toContain('Skills')
    expect(inspector).not.toContain('Hits')
    expect(inspector).toContain('Send')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-computer')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-desktop')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desktop-refresh')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-view')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-control')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark-shape')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark-color')).toBeTruthy()
    const inspectorBox = boundsFor(renderer, 'inspector')
    const dock = boundsFor(renderer, 'dock')
    const send = boundsFor(renderer, 'send')
    expect(inspectorBox.x).toBeGreaterThanOrEqual(dock.x + dock.width - 1)
    expect(send.x + send.width).toBeLessThanOrEqual(inspectorBox.x + 1)
    clickTestId(renderer, 'desk-control')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-stage')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-stage-view')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-release')).toBeTruthy()
    clickTestId(renderer, 'desk-stage-view')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-stage-view')).toBeTruthy()
    expect(renderer.getPaintedText().join(' ')).toContain('Release')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-name')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-job')).toBeFalsy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-ledger')).toBeFalsy()
    expect(statSync(inspectorShot).size).toBeGreaterThan(1000)

    clickTestId(renderer, 'inspector-close')
    renderer.flush()
    clickTestId(renderer, 'settings-open')
    renderer.flush()
    const settingsShot = 'artifacts/shots/shell-settings.png'
    renderer.captureScreenshot(settingsShot)
    const settings = renderer.getPaintedText().join(' ')
    expect(settings).toContain('model picker')
    expect(settings).toContain('one model per agent')
    expect(settings).toContain('Usage')
    expect(settings).not.toContain('unknown (')
    expect(settings).not.toContain('Prompt tokens')
    expect(settings).toContain('OpenRouter')
    expect(settings).toContain('Computer')
    expect(settings).toContain('One local Docker')
    expect(settings).not.toContain('Theme')
    expect(settings).toContain('Connectors')
    expect(settings).toContain('Stays out of the chat')
    expect(settings).toContain('Chief of Staff')
    expect(settings).not.toContain('Kernel')
    expect(settings).not.toContain('Research')
    expect(settings).toMatch(/\b(present|missing)\b/)
    expect(settings).toMatch(/Needs key|Connected|Rejected|Unreachable/)
    expect(settings).not.toMatch(/sk-[a-zA-Z0-9_-]{8,}/)
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'connector-openrouter')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-model-input')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-key-save')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-seat-staff')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-seat-kernel')).toBeFalsy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-computer')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-accent')).toBeFalsy()
    expect(statSync(settingsShot).size).toBeGreaterThan(1000)
  })

  test('update modal paints Updates available and Update', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 640, height: 400, position: 'relative' }}>
        <UpdateModal onUpdate={() => {}} onLater={() => {}} />
      </div>,
    )
    renderer.flush()
    const text = renderer.getPaintedText().join(' ')
    expect(text).toContain('Updates available')
    expect(text).toContain('Update')
    expect(text).toContain('Later')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'update-apply')).toBeTruthy()
  })

  test('inspector mark and rules stay inside the pane', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 640, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <Inspector
          agent={DEFAULT_AGENTS[0]}
          profile={{
            id: 'staff',
            name: 'Chief of Staff',
            title: 'Coordinator',
            description: '',
            rules: '',
            kit: 'coordinator',
            avatarShape: 'blob',
            avatarColor: 'red',
            namedBy: 'app',
            skillIds: [],
            notifyOnUpdates: false,
            hiddenFromRail: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            homeRepo: '',
            homePath: '',
          }}
          claims={[]}
          sandboxHint={null}
          onClose={() => {}}
          onPatch={() => {}}
        />
      </div>,
    )
    renderer.flush()
    const pane = boundsFor(renderer, 'inspector')
    const shape = boundsFor(renderer, 'inspector-mark-shape')
    const rules = boundsFor(renderer, 'inspector-rules')
    expect(shape.x + shape.width).toBeLessThanOrEqual(pane.x + pane.width - 16)
    expect(rules.x + rules.width).toBeLessThanOrEqual(pane.x + pane.width - 16)
  })

  test('inspector wheel over a kit pill still scrolls the pane', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 160, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <Inspector
          agent={DEFAULT_AGENTS[0]}
          profile={{
            id: 'staff',
            name: 'Chief of Staff',
            title: 'Coordinator',
            description: '',
            rules: 'Keep the thread moving.\n'.repeat(16),
            kit: 'coordinator',
            avatarShape: 'blob',
            avatarColor: 'staff',
            namedBy: 'app',
            skillIds: [],
            notifyOnUpdates: false,
            hiddenFromRail: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            homeRepo: '',
            homePath: '',
          }}
          claims={[]}
          sandboxHint={null}
          onClose={() => {}}
          onPatch={() => {}}
        />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const pane = findTestId(tree, 'inspector')
    if (typeof pane?.id !== 'number') throw new Error('no inspector id')
    const box = boundsFor(renderer, 'inspector')
    let kit = boundsFor(renderer, 'kit-code')
    if (kit.y < box.y || kit.y + kit.height > box.y + box.height) {
      const now = renderer.getScrollOffset(pane.id) ?? [0, 0]
      renderer.scrollTo(pane.id, now[0], now[1] + (box.y + 40 - kit.y))
      renderer.flush()
      kit = boundsFor(renderer, 'kit-code')
    }
    const before = renderer.getScrollOffset(pane.id) ?? [0, 0]
    renderer.nativeSimulateScrollWheel(
      Math.floor(kit.x + kit.width / 2),
      Math.floor(kit.y + kit.height / 2),
      80,
      80,
    )
    renderer.flush()
    const after = renderer.getScrollOffset(pane.id) ?? [0, 0]
    expect(after[1]).not.toBe(before[1])
    expect(after[0]).toBe(0)
  })

  test('inspector wheel over desktop controls still scrolls the pane', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 160, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <Inspector
          agent={DEFAULT_AGENTS[0]}
          profile={{
            id: 'staff',
            name: 'Chief of Staff',
            title: 'Coordinator',
            description: '',
            rules: 'Keep the thread moving.\n'.repeat(16),
            kit: 'coordinator',
            avatarShape: 'blob',
            avatarColor: 'staff',
            namedBy: 'app',
            skillIds: [],
            notifyOnUpdates: false,
            hiddenFromRail: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            homeRepo: '',
            homePath: '',
          }}
          claims={[]}
          sandboxHint={null}
          onClose={() => {}}
          onPatch={() => {}}
        />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const pane = findTestId(tree, 'inspector')
    if (typeof pane?.id !== 'number') throw new Error('no inspector id')
    expect(findTestId(tree, 'desk-view-hit')).toBeTruthy()
    let refresh = boundsFor(renderer, 'desktop-refresh')
    const box = boundsFor(renderer, 'inspector')
    if (refresh.y < box.y || refresh.y + refresh.height > box.y + box.height) {
      const now = renderer.getScrollOffset(pane.id) ?? [0, 0]
      renderer.scrollTo(pane.id, now[0], now[1] + (box.y + 40 - refresh.y))
      renderer.flush()
      refresh = boundsFor(renderer, 'desktop-refresh')
    }
    const before = renderer.getScrollOffset(pane.id) ?? [0, 0]
    renderer.nativeSimulateScrollWheel(
      Math.floor(refresh.x + refresh.width / 2),
      Math.floor(refresh.y + refresh.height / 2),
      80,
      80,
    )
    renderer.flush()
    const after = renderer.getScrollOffset(pane.id) ?? [0, 0]
    expect(after[1]).not.toBe(before[1])
  })

  test('settings keeps sister seats collapsed and shows frost controls', () => {
    const empty = {
      turns: 0,
      hits: 0,
      misses: 0,
      inferenceAvoided: 0,
      inferenceCalls: 0,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      promptTokensKnown: 0,
      promptTokensUnknown: 0,
      completionTokensKnown: 0,
      completionTokensUnknown: 0,
      costKnown: 0,
      costUnknown: 0,
    }
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 720, width: 400 }}>
        <Settings
          metrics={empty}
          agents={[
            DEFAULT_AGENTS[0],
            {
              id: 'puppet',
              name: 'Puppetmaster',
              title: 'Code',
              description: '',
              color: '#ff9800',
              hidden: false,
            },
          ]}
          onClose={() => {}}
        />
      </div>,
    )
    renderer.flush()
    let text = renderer.getPaintedText().join(' ')
    expect(text).toContain('Chief of Staff')
    expect(text).toContain('Other automata')
    expect(text).toContain('Frosted')
    expect(text).toContain('Solid')
    expect(text).not.toContain('Theme')
    expect(text).not.toContain('Puppetmaster')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-seat-staff')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-seat-puppet')).toBeFalsy()
    clickTestId(renderer, 'settings-seats-more')
    renderer.flush()
    text = renderer.getPaintedText().join(' ')
    expect(text).toContain('Puppetmaster')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings-seat-puppet')).toBeTruthy()
  })

  test('settings wheel over the save chip still scrolls the pane', () => {
    const empty = {
      turns: 0,
      hits: 0,
      misses: 0,
      inferenceAvoided: 0,
      inferenceCalls: 0,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      promptTokensKnown: 0,
      promptTokensUnknown: 0,
      completionTokensKnown: 0,
      completionTokensUnknown: 0,
      costKnown: 0,
      costUnknown: 0,
    }
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 160, width: 400 }}>
        <Settings metrics={empty} agents={[DEFAULT_AGENTS[0]]} onClose={() => {}} />
      </div>,
    )
    renderer.flush()
    const pane = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings')
    if (typeof pane?.id !== 'number') throw new Error('no settings id')
    const box = boundsFor(renderer, 'settings')
    let save = boundsFor(renderer, 'settings-key-save')
    if (save.y < box.y || save.y + save.height > box.y + box.height) {
      const now = renderer.getScrollOffset(pane.id) ?? [0, 0]
      renderer.scrollTo(pane.id, now[0], now[1] + (box.y + 40 - save.y))
      renderer.flush()
      save = boundsFor(renderer, 'settings-key-save')
    }
    const before = renderer.getScrollOffset(pane.id) ?? [0, 0]
    renderer.nativeSimulateScrollWheel(
      Math.floor(save.x + save.width / 2),
      Math.floor(save.y + save.height / 2),
      80,
      80,
    )
    renderer.flush()
    const after = renderer.getScrollOffset(pane.id) ?? [0, 0]
    expect(after[1]).not.toBe(before[1])
  })

  test('inspector claims show freshness and dim stale rows', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 640, display: 'flex', flexDirection: 'row' }}>
        <Inspector
          agent={DEFAULT_AGENTS[0]}
          claims={[
            {
              id: '1',
              ownerAgentId: 'staff',
              text: 'Marionette #223 merged.',
              source: 'job',
              freshness: 'stale',
            },
            {
              id: '2',
              ownerAgentId: 'staff',
              text: 'Marionette has 0 open PRs.',
              source: 'job',
              freshness: 'fresh',
            },
          ]}
          sandboxHint={null}
          onClose={() => {}}
        />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'claim-stale')).toBeTruthy()
    expect(findTestId(tree, 'claim-fresh')).toBeTruthy()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('stale')
    expect(painted).toContain('Marionette has 0 open PRs')
    expect(painted).toContain('#223')
  })

  test('rail right-click opens delete without stealing the focused mouth', () => {
    resetIdsForTests()
    const store = testStore()
    const sister = createAgent({ name: 'Kernel' })
    const agents = [...DEFAULT_AGENTS, sister.agent]
    store.save({
      agents,
      activeAgentId: 'staff',
      threads: emptyThreads(agents),
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const title = (tree: TreeNode | null) => {
      const node = findTestId(tree, 'titlebar-name')
      return node?.text ?? node?.children?.[0]?.text
    }
    expect(title(asTree(JSON.parse(renderer.getAutomationTree())))).toBe('Chief of Staff')
    rightClickTestId(renderer, `agent-${sister.agent.id}`)
    renderer.flush()
    const opened = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(title(opened)).toBe('Chief of Staff')
    expect(findTestId(opened, 'rail-menu')).toBeTruthy()
    expect(findTestId(opened, 'rail-menu-delete')).toBeTruthy()
    expect(containsTestId(findTestId(opened, 'rail'), 'rail-menu')).toBe(false)
    expect(findTestId(opened, 'delete-confirm')).toBeFalsy()
    const menuPaint = renderer.getPaintedText().join(' ')
    expect(menuPaint).toContain('Delete')
    expect(menuPaint).not.toContain('Del ete')
    expect(menuPaint).not.toContain('Delete Kernel?')
    clickTestId(renderer, 'rail-menu-delete')
    renderer.flush()
    const gone = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(gone, `agent-${sister.agent.id}`)).toBeFalsy()
    expect(findTestId(gone, 'rail-menu')).toBeFalsy()
    expect(title(gone)).toBe('Chief of Staff')
    expect(renderer.getPaintedText().join(' ')).not.toContain('Kernel')
  })

  test('compact rail delete menu stays a floating overlay', () => {
    resetIdsForTests()
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarMin })
    const sister = createAgent({ name: 'Kernel' })
    const agents = [...DEFAULT_AGENTS, sister.agent]
    store.save({
      agents,
      activeAgentId: 'staff',
      threads: emptyThreads(agents),
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    rightClickTestId(renderer, `agent-${sister.agent.id}`)
    renderer.flush()
    const opened = asTree(JSON.parse(renderer.getAutomationTree()))
    const rail = findTestId(opened, 'rail')
    const menu = findTestId(opened, 'rail-menu')
    expect(containsTestId(rail, 'rail-menu')).toBe(false)
    expect(menu?.bounds?.width ?? 0).toBeGreaterThan(rail?.bounds?.width ?? 0)
    expect(renderer.getPaintedText().join(' ')).toContain('Delete')
    expect(renderer.getPaintedText().join(' ')).not.toContain('Del ete')
  })

  test('settings star center opens settings', () => {
    const store = testStore()
    writeSkin({ railWidth: T.layout.sidebarMin })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const icon = boundsFor(renderer, 'settings-icon')
    renderer.nativeSimulateClick(
      Math.floor(icon.x + icon.width / 2),
      Math.floor(icon.y + icon.height / 2),
    )
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'settings')).toBeTruthy()
  })

  test('feed paints both bubbles and a clock on the first stamped line', () => {
    const at = Date.parse('2026-08-25T23:42:00')
    const store = testStore()
    const threads = emptyThreads(DEFAULT_AGENTS)
    threads.staff = {
      ...threads.staff,
      items: [
        { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hello from the right', at },
        { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'hello from the left', at: at + 30_000 },
      ],
    }
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'feed-clock')).toBeTruthy()
    expect(findTestId(tree, 'bubble-mine')).toBeTruthy()
    expect(findTestId(tree, 'bubble-theirs')).toBeTruthy()
    expect(renderer.getPaintedText().join(' ')).toContain('11:42 PM')
    const stage = boundsFor(renderer, 'stage')
    const mine = boundsFor(renderer, 'bubble-mine')
    const theirs = boundsFor(renderer, 'bubble-theirs')
    expect(mine.x).toBeGreaterThan(theirs.x)
    expect(mine.x + mine.width).toBeLessThanOrEqual(stage.x + stage.width - T.feed.gutter)
    expect(theirs.x).toBeGreaterThanOrEqual(T.layout.sidebarMin)
    expect(theirs.y).toBeGreaterThanOrEqual(mine.y + mine.height + T.feed.turn)
  })

  test('click selects a bubble and Cmd+A selects all msgs then copies them', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hello from the right' },
      { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'the line worth sharing' },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    clickTestId(renderer, 'bubble-mine')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'sel-u1')).toBeTruthy()
    const mine = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'bubble-mine')
    if (typeof mine?.id !== 'number') throw new Error('no bubble id')
    renderer.nativeSimulateKeystrokes(mine.id, 'cmd-a')
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'sel-u1')).toBeTruthy()
    expect(findTestId(tree, 'sel-a1')).toBeTruthy()
    renderer.nativeSimulateKeystrokes(mine.id, 'cmd-c')
    renderer.flush()
    expect(copiedInTests()).toBe('hello from the right\n\nthe line worth sharing')
  })

  test('click-drag across bubbles selects a feed range', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hello from the right' },
      { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'the line worth sharing' },
      { kind: 'msg', id: 'a2', from: 'agent', agentId: 'staff', text: 'a later finding' },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    const start = boundsFor(renderer, 'bubble-mine')
    const theirs = findAllTestIds(asTree(JSON.parse(renderer.getAutomationTree())), 'bubble-theirs')
    const endNode = theirs.at(-1)
    const end = boundsOf(endNode ?? null, renderer)
    renderer.nativeSimulateMouseDown(
      Math.floor(start.x + Math.min(40, start.width / 2)),
      Math.floor(start.y + start.height / 2),
    )
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'sel-u1')).toBeTruthy()
    renderer.nativeSimulateMouseMove(
      Math.floor(end.x + Math.min(40, end.width / 2)),
      Math.floor(end.y + end.height / 2),
      0,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'sel-u1')).toBeTruthy()
    expect(findTestId(tree, 'sel-a1')).toBeTruthy()
    expect(findTestId(tree, 'sel-a2')).toBeTruthy()
    renderer.nativeSimulateMouseUp(
      Math.floor(end.x + Math.min(40, end.width / 2)),
      Math.floor(end.y + end.height / 2),
    )
    renderer.flush()
    const mine = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'bubble-mine')
    if (typeof mine?.id !== 'number') throw new Error('no bubble id')
    renderer.nativeSimulateKeystrokes(mine.id, 'cmd-c')
    renderer.flush()
    expect(copiedInTests()).toBe('hello from the right\n\nthe line worth sharing\n\na later finding')
  })

  test('onSend paints the user bubble on the first commit', () => {
    const store = testStore()
    const threads = emptyThreads(DEFAULT_AGENTS)
    threads.staff = { ...threads.staff, draft: 'hello from the right' }
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'bubble-mine')).toBeFalsy()
    clickTestId(renderer, 'send')
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'bubble-mine')).toBeTruthy()
    expect(renderer.getPaintedText().join(' ')).toContain('hello from the right')
    expect(findTestId(tree, 'job-strip')).toBeFalsy()
    expect(findTestId(tree, 'composer-stop')).toBeTruthy()
  })

  test('send render does not query claims or metrics', () => {
    const inner = testStore()
    let metricsCalls = 0
    let claimCalls = 0
    const store = {
      ...inner,
      metrics() {
        metricsCalls += 1
        return inner.metrics()
      },
      listClaims() {
        claimCalls += 1
        return inner.listClaims()
      },
    }
    const threads = emptyThreads(DEFAULT_AGENTS)
    threads.staff = { ...threads.staff, draft: 'hello from the right' }
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    metricsCalls = 0
    claimCalls = 0
    clickTestId(renderer, 'send')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'bubble-mine')).toBeTruthy()
    expect(metricsCalls).toBe(0)
    expect(claimCalls).toBe(0)
  })

  test('right-click on a bubble copies its text and flashes Copied', () => {
    const at = Date.parse('2026-08-25T23:42:00')
    const store = testStore()
    const threads = emptyThreads(DEFAULT_AGENTS)
    threads.staff = {
      ...threads.staff,
      items: [
        { kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'hello from the right', at },
        { kind: 'msg', id: 'a1', from: 'agent', agentId: 'staff', text: 'the line worth sharing', at: at + 30_000 },
      ],
    }
    store.save({
      agents: DEFAULT_AGENTS,
      activeAgentId: 'staff',
      threads,
      jobs: [],
      pendingFanout: null,
    })
    const { render, renderer } = createTestRoot()
    render(<App store={store} />)
    renderer.flush()
    rightClickTestId(renderer, 'bubble-theirs')
    renderer.flush()
    expect(copiedInTests()).toBe('the line worth sharing')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'copied-mark')).toBeTruthy()
    clickTestId(renderer, 'bubble-theirs')
    renderer.flush()
    expect(copiedInTests()).toBe('the line worth sharing')
  })

  test('agent transcript uses native markdown and fenced code paint', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: 'user_1', from: 'user', agentId: 'staff', text: 'Show the finding.' },
      {
        kind: 'msg',
        id: 'agent_1',
        from: 'agent',
        agentId: 'staff',
        text: '# Finding\n\n```ts\nconst answer = 42\n```',
      },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} />
      </div>,
    )
    renderer.flush()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Finding')
    expect(painted).toContain('const answer = 42')
  })

  test('user attachment thumbs share the mine bubble gutter', () => {
    const png = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    const items: FeedItem[] = [
      {
        kind: 'msg',
        id: 'user_1',
        from: 'user',
        agentId: 'staff',
        text: 'Are these stats pretty decent?',
        attachmentIds: ['att_1'],
      },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed
          items={items}
          agents={DEFAULT_AGENTS}
          storeAnswer={() => false}
          attachmentsFor={() => [{ id: 'att_1', path: png, kind: 'image' }]}
        />
      </div>,
    )
    renderer.flush()
    const thumb = boundsFor(renderer, 'thumb-att_1')
    const mine = boundsFor(renderer, 'bubble-mine')
    expect(thumb.x + thumb.width).toBe(mine.x + mine.width)
  })

  test('feed paints thinking dots while the mouth answers', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: 'user_1', from: 'user', agentId: 'staff', text: 'Hello.' },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} mouth="answer" />
      </div>,
    )
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'thinking')).toBeTruthy()
    expect(renderer.getPaintedText().join(' ')).toContain('.')
  })

  test('feed hides thinking after a reply and during a job', () => {
    const items: FeedItem[] = [
      { kind: 'msg', id: 'user_1', from: 'user', agentId: 'staff', text: 'Hello.' },
      { kind: 'msg', id: 'agent_1', from: 'agent', agentId: 'staff', text: 'Hi.' },
    ]
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} mouth="idle" />
      </div>,
    )
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'thinking')).toBeNull()
    render(
      <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
        <Feed
          items={[items[0]!]}
          agents={DEFAULT_AGENTS}
          storeAnswer={() => false}
          mouth="working"
        />
      </div>,
    )
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'thinking')).toBeNull()
  })

  test('New automaton deals a mark, paints the row, and opens inspector', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    clickTestId(renderer, 'new-agent')
    renderer.flush()
    const shot = 'artifacts/shots/shell-new-agent.png'
    renderer.captureScreenshot(shot)
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('New automaton')
    expect(painted).toContain('Inspector')
    expect(painted).toContain('code')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark-shape')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark-color')).toBeTruthy()
    expect(statSync(shot).size).toBeGreaterThan(1000)
  })

  test('composer plus queues an image and Send paints a thumb', async () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const png = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    process.env.AUTOMATON_PICK_FILES = png
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    clickTestId(renderer, 'attach')
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).toContain('rest.png')
    clickTestId(renderer, 'send')
    renderer.flush()
    await Promise.resolve()
    await Promise.resolve()
    renderer.flush()
    const shot = 'artifacts/shots/shell-attach.png'
    renderer.captureScreenshot(shot)
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestIdPrefix(tree, 'thumb-')).toBeTruthy()
    expect(statSync(shot).size).toBeGreaterThan(1000)
    delete process.env.AUTOMATON_PICK_FILES
  })

  test('composer Remove drops a queued file before send', () => {
    const png = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    process.env.AUTOMATON_PICK_FILES = png
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    clickTestId(renderer, 'attach')
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).toContain('rest.png')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pending-drop-0')).toBeTruthy()
    clickTestId(renderer, 'pending-drop-0')
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).not.toContain('rest.png')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pending-files')).toBeNull()
    delete process.env.AUTOMATON_PICK_FILES
  })

  test('composer plus opens the picker and ignores the clipboard', () => {
    const pick = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    const clip = join(import.meta.dir, '../src/marks/hex/kernel/rest.png')
    process.env.AUTOMATON_PICK_FILES = pick
    process.env.AUTOMATON_CLIP_FILES = clip
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    clickTestId(renderer, 'attach')
    renderer.flush()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('rest.png')
    expect(painted).not.toContain('kernel')
    delete process.env.AUTOMATON_PICK_FILES
    delete process.env.AUTOMATON_CLIP_FILES
  })

  test('composer cmd-v queues a clipboard image', () => {
    const png = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    process.env.AUTOMATON_CLIP_FILES = png
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const app = findTestId(tree, 'app')
    if (typeof app?.id !== 'number') throw new Error('no app id')
    renderer.nativeSimulateKeyDown(app.id, 'cmd-v')
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).toContain('rest.png')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pending-files')).toBeTruthy()
    delete process.env.AUTOMATON_CLIP_FILES
  })

  test('composer cmd-v inserts clipboard text', () => {
    process.env.AUTOMATON_CLIP_TEXT = 'hello from paste'
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const app = findTestId(tree, 'app')
    if (typeof app?.id !== 'number') throw new Error('no app id')
    renderer.nativeSimulateKeyDown(app.id, 'cmd-v')
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).toContain('hello from paste')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pending-files')).toBeNull()
    delete process.env.AUTOMATON_CLIP_TEXT
  })

  test('composer right-click plus queues the clipboard', () => {
    const png = join(import.meta.dir, '../src/marks/blob/staff/rest.png')
    process.env.AUTOMATON_CLIP_FILES = png
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const attach = findTestId(tree, 'attach')
    const box =
      attach?.bounds ??
      (typeof attach?.id === 'number'
        ? (() => {
            const raw = renderer.getElementBounds(attach.id)
            return raw ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] } : null
          })()
        : null)
    if (!box || box.width <= 0) throw new Error('no painted bounds for attach')
    renderer.nativeSimulateMouseDown(
      Math.floor(box.x + box.width / 2),
      Math.floor(box.y + box.height / 2),
      2,
    )
    renderer.flush()
    expect(renderer.getPaintedText().join(' ')).toContain('rest.png')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pending-files')).toBeTruthy()
    delete process.env.AUTOMATON_CLIP_FILES
  })
})
