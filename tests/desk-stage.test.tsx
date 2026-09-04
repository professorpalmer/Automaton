import { copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, spyOn, test } from 'bun:test'
import React from 'react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DeskStage, applyDeskKey } from '../src/desk'
import * as deskRuntime from '../src/runtime/desk'
import { mapViewToDisplay } from '../src/runtime/desk'
import { screenPath } from '../src/runtime/desktop'
import { T } from '../src/tokens'

const native = hasNativeTestRenderer ? describe : describe.skip
const PNG = join(import.meta.dir, '../src/marks/blob/staff/rest.png')

type TreeNode = {
  type?: string
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

function findTestId(node: TreeNode | null, testId: string): TreeNode | null {
  if (!node) return null
  if (node.testId === testId || node.customProps?.testId === testId) return node
  for (const child of node.children ?? []) {
    const found = findTestId(child, testId)
    if (found) return found
  }
  return null
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
    Math.floor(bounds.x + bounds.width / 2),
    Math.floor(bounds.y + bounds.height / 2),
  )
}

function mouseDownTestId(renderer: ReturnType<typeof createTestRoot>['renderer'], testId: string) {
  const bounds = boundsFor(renderer, testId)
  renderer.nativeSimulateMouseDown(
    Math.floor(bounds.x + Math.min(40, bounds.width / 2)),
    Math.floor(bounds.y + bounds.height / 2),
  )
}

function blitIdentities(node: TreeNode | null): string[] {
  if (!node) return []
  const id = node.testId ?? node.customProps?.testId
  const here = id?.startsWith('desk-stage-blit-') ? [id] : []
  return here.concat((node.children ?? []).flatMap((child) => blitIdentities(child)))
}

native('take-control blit hits', () => {
  test('a filled pane under a pass-through img receives the click', () => {
    let hits = 0
    const { render, renderer } = createTestRoot()
    render(
      <div
        testId="pane"
        style={{
          width: 400,
          height: 300,
          backgroundColor: T.raised,
          pointerEvents: 'auto',
        }}
        onClick={() => {
          hits += 1
        }}
      >
        <img
          src={PNG}
          objectFit="contain"
          alt=""
          style={{ width: 400, height: 300, pointerEvents: 'none' }}
        />
      </div>,
    )
    clickTestId(renderer, 'pane')
    renderer.flush()
    expect(hits).toBe(1)
  })

  test('DeskStage with a screen wires click on a div, not the img', () => {
    const home = join(tmpdir(), `automaton-desk-stage-${Date.now()}-${Math.random()}`)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    copyFileSync(PNG, screenPath('staff', home))
    process.env.AUTOMATON_HOME = home
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 960, height: 720, backgroundColor: T.canvas }}>
        <DeskStage agentId="staff" name="Chief of Staff" left={0} onRelease={() => {}} />
      </div>,
    )
    renderer.flush()
    const tree = asTree(JSON.parse(renderer.getAutomationTree()))
    const view = findTestId(tree, 'desk-stage-view')
    expect(view).toBeTruthy()
    const el = renderer.getElement(view!.id as number)
    expect(el?.type).toBe('div')
    expect(el?.events.has('click')).toBe(true)
    expect(el?.events.has('mouseDown')).toBe(true)
    expect(el?.events.has('keyDown')).toBe(true)
    const box = renderer.getElementBounds(view!.id as number)
    expect((box?.[2] ?? 0) * (box?.[3] ?? 0)).toBeGreaterThan(0)
    clickTestId(renderer, 'desk-stage-view')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-release')).toBeTruthy()
  })

  test('a mouseDown on desk-stage-view forwards a mapped display point', () => {
    const home = join(tmpdir(), `automaton-desk-hit-${Date.now()}-${Math.random()}`)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    copyFileSync(PNG, screenPath('staff', home))
    process.env.AUTOMATON_HOME = home
    const clicks: Array<{ x: number; y: number }> = []
    const spy = spyOn(deskRuntime, 'clickDesk').mockImplementation((_id, point) => {
      clicks.push(point)
      return true
    })
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 960, height: 720, backgroundColor: T.canvas }}>
        <DeskStage agentId="staff" name="Chief of Staff" left={0} onRelease={() => {}} />
      </div>,
    )
    renderer.flush()
    const bounds = boundsFor(renderer, 'desk-stage-view')
    const cx = Math.floor(bounds.x + bounds.width / 2)
    const cy = Math.floor(bounds.y + bounds.height / 2)
    const mapped = mapViewToDisplay(bounds, { x: cx, y: cy })
    expect(mapped).not.toBeNull()
    renderer.nativeSimulateMouseDown(cx, cy)
    renderer.flush()
    spy.mockRestore()
    expect(clicks).toEqual([mapped])
  })

  test('a blit mouseDown does not fire Release', () => {
    const home = join(tmpdir(), `automaton-desk-stay-${Date.now()}-${Math.random()}`)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    copyFileSync(PNG, screenPath('staff', home))
    process.env.AUTOMATON_HOME = home
    let released = 0
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 960, height: 720, backgroundColor: T.canvas }}>
        <DeskStage agentId="staff" name="Chief of Staff" left={0} onRelease={() => { released += 1 }} />
      </div>,
    )
    renderer.flush()
    clickTestId(renderer, 'desk-stage-view')
    renderer.flush()
    expect(released).toBe(0)
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-stage-view')).toBeTruthy()
    mouseDownTestId(renderer, 'desk-release')
    renderer.flush()
    expect(released).toBe(1)
  })

  test('a mouseDown without mouseUp keeps two blits in old-to-new order when the paint path repeats', () => {
    const home = join(tmpdir(), `automaton-desk-blit-${Date.now()}-${Math.random()}`)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    copyFileSync(PNG, screenPath('staff', home))
    process.env.AUTOMATON_HOME = home
    const paint = screenPath('staff', home)
    const spy = spyOn(deskRuntime, 'captureDesk').mockImplementation(() => paint)
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 960, height: 720, backgroundColor: T.canvas }}>
        <DeskStage agentId="staff" name="Chief of Staff" left={0} onRelease={() => {}} />
      </div>,
    )
    renderer.flush()
    const before = blitIdentities(asTree(JSON.parse(renderer.getAutomationTree())))
    expect(before.length).toBeGreaterThanOrEqual(1)
    const bounds = boundsFor(renderer, 'desk-stage-view')
    const x = Math.floor(bounds.x + Math.min(40, bounds.width / 2))
    const y = Math.floor(bounds.y + bounds.height / 2)
    renderer.nativeSimulateMouseDown(x, y)
    renderer.flush()
    const after = blitIdentities(asTree(JSON.parse(renderer.getAutomationTree())))
    spy.mockRestore()
    expect(after).toHaveLength(2)
    expect(after[0]).not.toBe(after[1])
    const older = Number(after[0].slice('desk-stage-blit-'.length))
    const newer = Number(after[1].slice('desk-stage-blit-'.length))
    expect(older).toBeLessThan(newer)
  })

  test('a click fallback still forwards once when mouseDown did not arm', () => {
    const home = join(tmpdir(), `automaton-desk-click-${Date.now()}-${Math.random()}`)
    mkdirSync(join(home, 'desktops', 'staff'), { recursive: true })
    copyFileSync(PNG, screenPath('staff', home))
    process.env.AUTOMATON_HOME = home
    const clicks: Array<{ x: number; y: number }> = []
    const spy = spyOn(deskRuntime, 'clickDesk').mockImplementation((_id, point) => {
      clicks.push(point)
      return true
    })
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 960, height: 720, backgroundColor: T.canvas }}>
        <DeskStage agentId="staff" name="Chief of Staff" left={0} onRelease={() => {}} />
      </div>,
    )
    renderer.flush()
    const bounds = boundsFor(renderer, 'desk-stage-view')
    const cx = Math.floor(bounds.x + bounds.width / 2)
    const cy = Math.floor(bounds.y + bounds.height / 2)
    renderer.nativeSimulateClick(cx, cy)
    renderer.flush()
    spy.mockRestore()
    expect(clicks).toHaveLength(1)
  })
})

describe('desk quit chord', () => {
  test('Cmd+Q quits instead of sending a box key', () => {
    const sent: unknown[] = []
    let quits = 0
    applyDeskKey({ key: 'q', modifiers: { cmd: true } }, 'staff', {
      quit: () => {
        quits += 1
      },
      send: (_id, stroke) => {
        sent.push(stroke)
        return true
      },
    })
    applyDeskKey({ key: 'a', modifiers: { cmd: true } }, 'staff', {
      quit: () => {
        quits += 1
      },
      send: (_id, stroke) => {
        sent.push(stroke)
        return true
      },
    })
    expect(quits).toBe(1)
    expect(sent).toEqual([{ via: 'key', value: 'ctrl+a' }])
  })
})
