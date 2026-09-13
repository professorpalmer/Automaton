import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { MOTION, SPRINGS, motionSpec, motionTransition, springSpec } from '../src/motion'
import { T } from '../src/tokens'

const HOT = [
  'src/app.tsx',
  'src/cards.tsx',
  'src/ui.tsx',
  'src/chrome/composer.tsx',
  'src/chrome/activity-zone.tsx',
  'src/chrome/titlebar.tsx',
  'src/blob.tsx',
]

describe('MotionSpec catalog', () => {
  test('named specs carry duration + curve; springs stay named', () => {
    expect(motionSpec('railResize')).toEqual({ duration: T.motion.pane, curve: 'easeOut' })
    expect(motionSpec('paneIn').duration).toBe(T.motion.pane)
    expect(motionSpec('unreadFade').duration).toBe(T.motion.unread)
    expect(motionSpec('blobEnter').duration).toBe(T.motion.enter)
    expect(motionSpec('blobSelected').duration).toBe(T.motion.selected)
    expect(motionSpec('blobBreathe')).toEqual({ duration: T.motion.breathe, curve: 'easeInOut' })
    expect(springSpec('gelatin')).toEqual(SPRINGS.gelatin)
    expect(springSpec('eye').stiffness).toBe(13)
    expect(SPRINGS.gelatin.type).toBe('spring')
  })

  test('call sites name specs; gpuix transition maps the catalog', () => {
    const transition = motionTransition('paneIn')
    expect(transition.ease).toBe(MOTION.paneIn.curve)
    expect(transition.duration).toBe(0)
    for (const rel of HOT) {
      const src = readFileSync(join(import.meta.dir, '..', rel), 'utf8')
      expect(src, rel).not.toMatch(/ease:\s*'easeOut'/)
      expect(src, rel).not.toMatch(/ease:\s*'easeInOut'/)
      expect(src, rel).not.toContain('applyChromeToTokens')
    }
    const app = readFileSync(join(import.meta.dir, '..', 'src/app.tsx'), 'utf8')
    expect(app).toContain("motionTransition('railResize'")
    expect(app).toContain("motionTransition('paneIn')")
    expect(app).toContain("motionTransition('unreadFade')")
    expect(app).toContain('useTokens()')
    expect(app).toContain('toChatTheme')
  })
})
