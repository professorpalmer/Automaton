import { copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DeskStage } from '../src/desk'
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

native('take-control blit hits', () => {
  test('gpuix img has no painted hit bounds', () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ width: 400, height: 300, backgroundColor: T.raised }}>
        <img
          testId="pic"
          src={PNG}
          objectFit="contain"
          alt=""
          style={{ width: 400, height: 300, pointerEvents: 'auto' }}
        />
      </div>,
    )
    renderer.flush()
    const node = findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'pic')
    expect(node).toBeTruthy()
    const box = typeof node?.id === 'number' ? renderer.getElementBounds(node.id) : null
    const width = node?.bounds?.width ?? box?.[2] ?? 0
    const height = node?.bounds?.height ?? box?.[3] ?? 0
    expect(width * height).toBe(0)
  })

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
    expect(el?.events.has('keyDown')).toBe(true)
    clickTestId(renderer, 'desk-stage-view')
    renderer.flush()
    expect(findTestId(asTree(JSON.parse(renderer.getAutomationTree())), 'desk-release')).toBeTruthy()
  })
})
