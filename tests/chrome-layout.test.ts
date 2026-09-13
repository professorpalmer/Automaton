import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  controlClusterStyle,
  titlebarRowStyle,
  trafficLightClearance,
} from '../src/chrome/layout'
import { T } from '../src/tokens'

describe('titlebar / control-bar discipline', () => {
  test('Darwin clears traffic lights; other platforms stay tight', () => {
    expect(trafficLightClearance(T, 'darwin')).toBe(T.layout.trafficLightClearance)
    expect(trafficLightClearance(T, 'linux')).toBe(T.space.sm)
    const row = titlebarRowStyle(T, 'darwin')
    expect(row.paddingLeft).toBe(T.layout.trafficLightClearance)
    expect(row.height).toBe(T.layout.titlebarHeight)
    expect(controlClusterStyle(T).flexShrink).toBe(0)
    const app = readFileSync(join(import.meta.dir, '../src/app.tsx'), 'utf8')
    expect(app).toContain("from './chrome'")
    expect(app).not.toContain('function Titlebar(')
    expect(app).not.toContain('function SlidePane(')
    expect(app).not.toContain('paddingLeft: TRAFFIC')
    const bar = readFileSync(join(import.meta.dir, '../src/chrome/titlebar.tsx'), 'utf8')
    expect(bar).toContain('titlebarRowStyle')
    expect(bar).toContain('controlClusterStyle')
    expect(bar).toContain('inspectArmed')
  })
})
