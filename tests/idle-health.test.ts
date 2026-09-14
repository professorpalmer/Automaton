import { describe, expect, test } from 'bun:test'
import { STREAM_COMMIT_MS } from '../src/runtime/feed-pin'
import {
  IDLE_CPU_PACED_BASELINE_PCT,
  IDLE_CPU_WARN_PCT,
  IDLE_FRAME_MS,
  IDLE_SPRING_SETTLE_HARD_MS,
  doctorIdleCpu,
  idleCpuLooksHot,
  idleParkInventory,
  meanCpu,
  parsePsCpuLines,
  sampleAutomatonCpu,
} from '../src/runtime/idle-health'
import { doctorPuppetmaster } from '../src/runtime/doctor'
import { SETTLE_HARD_MS, SPRING_FRAME_MS } from '../src/resting-motion'

describe('idle park inventory', () => {
  test('lists the shipped parks with coalesce / settle invariants', () => {
    const parks = idleParkInventory()
    expect(parks.map((p) => p.id)).toEqual([
      'spring-lease',
      'sister-freeze',
      'stream-commit',
      'row-fingerprint',
      'frame-pace',
      'activity-takeover',
      'pulse-stride',
      'os-notify-focus',
    ])
    expect(STREAM_COMMIT_MS).toBe(120)
    expect(IDLE_SPRING_SETTLE_HARD_MS).toBe(SETTLE_HARD_MS)
    expect(IDLE_FRAME_MS).toBe(SPRING_FRAME_MS)
    expect(parks.find((p) => p.id === 'spring-lease')?.path).toContain('motion.rs')
    expect(parks.find((p) => p.id === 'spring-lease')?.summary).toMatch(/native/)
    expect(parks.find((p) => p.id === 'spring-lease')?.summary).toMatch(/420/)
    expect(parks.find((p) => p.id === 'stream-commit')?.summary).toContain('120ms')
    expect(parks.find((p) => p.id === 'frame-pace')?.summary).toContain('8ms')
  })
})

describe('idle CPU math', () => {
  test('parses ps lines and means', () => {
    expect(parsePsCpuLines('  6.5\n5.5\n\nbad\n6.0\n')).toEqual([6.5, 5.5, 6.0])
    expect(meanCpu([6, 8, 10])).toBe(8)
    expect(idleCpuLooksHot(6)).toBe(false)
    expect(idleCpuLooksHot(IDLE_CPU_WARN_PCT)).toBe(true)
    expect(idleCpuLooksHot(39.9)).toBe(false)
    expect(IDLE_CPU_PACED_BASELINE_PCT).toBe(1.5)
  })

  test('sample helper uses injected reads (no GUI required)', () => {
    const sample = sampleAutomatonCpu({
      pid: 4242,
      samples: 3,
      intervalMs: 0,
      readCpu: () => 6.2,
      sleep: () => {},
    })
    expect(sample).toEqual({
      pid: 4242,
      meanPct: 6.2,
      samples: [6.2, 6.2, 6.2],
      etime: undefined,
      cputime: undefined,
    })
  })
})

describe('doctor idle CPU', () => {
  test('defaults to skip checklist note (CI-safe)', () => {
    const report = doctorIdleCpu({ forceSkip: true })
    expect(report.status).toBe('skip')
    expect(report.note).toContain('docs/idle-cpu.md')
    expect(report.parks.length).toBe(8)
  })

  test('WARNs when a live sample is hot', () => {
    const report = doctorIdleCpu({
      sampleLive: true,
      sample: () => ({
        pid: 99,
        meanPct: 55,
        samples: [50, 55, 60],
      }),
    })
    expect(report.status).toBe('warn')
    expect(report.note).toContain('55%')
    expect(report.note).toContain('docs/idle-cpu.md')
  })

  test('ok when live sample is under the thrash gate', () => {
    const report = doctorIdleCpu({
      sampleLive: true,
      sample: () => ({
        pid: 99,
        meanPct: 6.2,
        samples: [5.5, 6.2, 6.9],
      }),
    })
    expect(report.status).toBe('ok')
    expect(report.note).toContain('6.2%')
  })

  test('doctor report always carries idleCpu without flipping ok', () => {
    const report = doctorPuppetmaster({ listPs: () => '' })
    expect(report.idleCpu).toBe('skip')
    expect(report.idleCpuNote).toContain('docs/idle-cpu.md')
  }, { timeout: 20_000 })
})
