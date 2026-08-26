import { mkdirSync, statSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/app'

const native = hasNativeTestRenderer ? describe : describe.skip

native('staff shell (GPUI native)', () => {
  test('rail, empty feed, and Send are painted', () => {
    mkdirSync('artifacts/shots', { recursive: true })
    const { render, renderer } = createTestRoot()
    render(<App />)
    const shot = 'artifacts/shots/shell-idle.png'
    renderer.captureScreenshot(shot)
    const painted = renderer.getPaintedText().join(' ')
    expect(painted).toContain('Staff')
    expect(painted).toContain('Kernel')
    expect(painted).toContain('Research')
    expect(painted).toContain('Send')
    expect(painted).toContain('Message this agent')
    expect(statSync(shot).size).toBeGreaterThan(1000)
  })
})
