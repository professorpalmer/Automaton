import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import React from 'react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, Feed, JobStrip } from '../src/app'
import { assertSeedFrames, blobNeedsClock, presentBlob, SisterBlob } from '../src/blob'
import { DEFAULT_AGENTS, type FeedItem, type JobHandle } from '../src/domain'
import { openStaffStore } from '../src/runtime/store'
import { T } from '../src/tokens'

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

function clickTestId(renderer: ReturnType<typeof createTestRoot>['renderer'], testId: string) {
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
  renderer.nativeSimulateClick(
    Math.floor(bounds.x + Math.min(40, bounds.width / 2)),
    Math.floor(bounds.y + bounds.height / 2),
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

describe('sister blob presentation', () => {
  test('seed trio frames exist and the glyph source is not a fill chip', () => {
    assertSeedFrames()
    const src = readFileSync(join(import.meta.dir, '../src/blob.tsx'), 'utf8')
    expect(src).not.toMatch(/backgroundColor/)
    expect(src).not.toMatch(/tickMs|splitCycle|cycleLayers/)
    expect(src).toMatch(/pointerEvents:\s*'none'/)
    const app = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    expect(app).not.toMatch(/selected \? T.overlayStrong : T.clear/)
    expect(app).toMatch(/pointerEvents: 'auto'/)
  })

  test('selected lifts, idle is still, and chew is mouth-busy only', () => {
    const idle = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      chewSide: 'a',
      index: 0,
      entered: true,
    })
    const selected = presentBlob({
      selected: true,
      unread: 0,
      mouthBusy: false,
      chewSide: 'a',
      index: 0,
      entered: true,
    })
    const unread = presentBlob({
      selected: false,
      unread: 2,
      mouthBusy: false,
      chewSide: 'b',
      index: 2,
      entered: true,
    })
    const busy = presentBlob({
      selected: true,
      unread: 1,
      mouthBusy: true,
      chewSide: 'a',
      index: 1,
      entered: true,
    })
    const busyB = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: true,
      chewSide: 'b',
      index: 0,
      entered: true,
    })
    expect(idle.weights).toEqual({ rest: 1, breathe: 0, selected: 0, chewA: 0, chewB: 0 })
    expect(idle.glyphHeight).toBe(T.blob.size)
    expect(idle.lift).toBe(0)
    expect(blobNeedsClock(false)).toBe(false)
    expect(selected.weights).toEqual({ rest: 0, breathe: 0, selected: 1, chewA: 0, chewB: 0 })
    expect(selected.lift).toBe(T.blob.selectedLift)
    expect(selected.duration).toBe(T.motion.selected)
    expect(blobNeedsClock(false)).toBe(false)
    expect(unread.weights.rest).toBe(1)
    expect(unread.weights.chewA).toBe(0)
    expect(unread.weights.chewB).toBe(0)
    expect(busy.weights).toEqual({ rest: 0, breathe: 0, selected: 0, chewA: 1, chewB: 0 })
    expect(busy.duration).toBe(T.blob.chewMs / 1000)
    expect(busy.glyphHeight).toBe(T.blob.size)
    expect(busy.lift).toBe(T.blob.selectedLift)
    expect(busyB.weights.chewB).toBe(1)
    expect(busyB.weights.chewA).toBe(0)
    expect(blobNeedsClock(true)).toBe(true)
  })

  test('a job handle is not an input, so it cannot chew a mouth', () => {
    const kernel = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      chewSide: 'b',
      index: 1,
      entered: true,
    })
    expect(kernel.weights.chewA).toBe(0)
    expect(kernel.weights.chewB).toBe(0)
    expect(kernel.weights.rest).toBe(1)
    expect(kernel.duration).not.toBe(T.blob.chewMs / 1000)
    expect(kernel.glyphWidth).toBe(T.blob.size)
  })

  test('first paint shows the rest frame so the rail is never an empty chip', () => {
    const mount = presentBlob({
      selected: false,
      unread: 0,
      mouthBusy: false,
      chewSide: 'a',
      index: 2,
      entered: false,
    })
    expect(mount.weights.rest).toBe(1)
    expect(mount.weights.chewA).toBe(0)
    expect(mount.glyphWidth).toBe(T.blob.enterSize)
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
    expect(painted).toContain('Staff')
    expect(painted).toContain('Kernel')
    expect(painted).toContain('Research')
    expect(painted).toContain('Send')
    expect(painted).toContain('Message this agent')
    expect(painted).toContain('Settings')
    expect(statSync(shot).size).toBeGreaterThan(1000)
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    expect(findTestId(tree, 'blob-staff')).toBeTruthy()
    expect(findTestId(tree, 'blob-kernel')).toBeTruthy()
    expect(findTestId(tree, 'blob-research')).toBeTruthy()
    expect(findTestId(tree, 'new-agent')).toBeTruthy()
    expect(findTestId(tree, 'attach')).toBeTruthy()
    expect(painted).toContain('New agent')
    const blob = findTestId(tree, 'blob-staff')
    expect(blob?.bounds?.width ?? 0).toBeLessThanOrEqual(T.blob.slot + 4)
    expect(blob?.bounds?.height ?? 0).toBeLessThanOrEqual(T.blob.slot + 4)
    expect(collectOversized(blob, T.blob.slot + 4)).toEqual([])
    clickTestId(renderer, 'agent-kernel')
    renderer.flush()
    const after = asTree(JSON.parse(renderer.getAutomationTree()))
    const title = findTestId(after, 'titlebar-name')
    expect(title?.text ?? title?.children?.[0]?.text).toBe('Kernel')
  })

  test('only the mouth-busy sister pulses; a job handle is not mouth busy', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div>
        {DEFAULT_AGENTS.map((agent, index) => (
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
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const staff = findTestId(tree, 'blob-staff')
    const kernel = findTestId(tree, 'blob-kernel')
    const research = findTestId(tree, 'blob-research')
    expect(staff).toBeTruthy()
    expect(kernel).toBeTruthy()
    expect(research).toBeTruthy()

    renderer.clockPause()
    renderer.clockFastForward(T.blob.chewMs)
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'blob-kernel')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'blob-staff')).toBeTruthy()
  })

  test('job handle labels stay on one row', () => {
    const job: JobHandle = {
      id: 'layout-job',
      ownerAgentId: 'kernel',
      goal: 'read-only UI verification',
      status: 'running',
      kind: 'analyze',
    }
    const { render, renderer } = createTestRoot()
    render(<JobStrip jobs={[job]} agents={DEFAULT_AGENTS} onStop={() => {}} />)
    renderer.flush()

    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const strip = findTestId(tree, 'job-strip')
    const row = strip?.children?.[0]
    const label = row?.children?.[0]
    expect(label?.children).toHaveLength(1)
    expect(label?.children?.[0]?.text).toBe('Kernel · analyze · read-only UI verification')
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
    expect(inspector).toContain('Desktop')
    expect(inspector).toContain('No screen yet')
    expect(inspector).toContain('Refresh')
    expect(inspector).toContain('Last job')
    expect(inspector).toContain('Mark')
    expect(inspector).toContain('Kit')
    expect(inspector).toContain('Rules')
    expect(inspector).toContain('Skills')
    expect(inspector).toContain('Hits')
    expect(inspector).toContain('Misses')
    expect(inspector).toContain('Avoided')
    expect(inspector).toContain('Calls')
    expect(inspector).toContain('Send')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-desktop')).toBeTruthy()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desktop-refresh')).toBeTruthy()
    expect(statSync(inspectorShot).size).toBeGreaterThan(1000)

    clickTestId(renderer, 'inspector-close')
    renderer.flush()
    clickTestId(renderer, 'settings-open')
    renderer.flush()
    const settingsShot = 'artifacts/shots/shell-settings.png'
    renderer.captureScreenshot(settingsShot)
    const settings = renderer.getPaintedText().join(' ')
    expect(settings).toContain('Usage')
    expect(settings).toContain('Keys')
    expect(settings).toContain('Theme')
    expect(settings).toContain('Connectors')
    expect(settings).toContain('Stays out of the chat')
    expect(settings).toMatch(/\b(present|missing)\b/)
    expect(settings).toContain('Graphite')
    expect(settings).toMatch(/Needs key|Connected|Rejected|Unreachable/)
    expect(settings).not.toMatch(/sk-[a-zA-Z0-9_-]{8,}/)
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'connector-openrouter')).toBeTruthy()
    expect(statSync(settingsShot).size).toBeGreaterThan(1000)
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
    render(<Feed items={items} agents={DEFAULT_AGENTS} storeAnswer={() => false} />)
    renderer.flush()
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Finding')
    expect(painted).toContain('const answer = 42')
  })

  test('New agent deals a mark, paints the row, and opens inspector', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const { render, renderer } = createTestRoot()
    render(<App store={testStore()} />)
    renderer.flush()
    clickTestId(renderer, 'new-agent')
    renderer.flush()
    const shot = 'artifacts/shots/shell-new-agent.png'
    renderer.captureScreenshot(shot)
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('New Bot')
    expect(painted).toContain('Inspector')
    expect(painted).toContain('blank')
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'inspector-mark')).toBeTruthy()
    expect(statSync(shot).size).toBeGreaterThan(1000)
  })

  test('composer plus queues an image and Send paints a thumb', () => {
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
})
