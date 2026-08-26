import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_SEAT_MODEL,
  jobModel,
  mouthModel,
  parsePlane,
  readPlane,
  seatModel,
  writePlane,
} from '../src/runtime/plane'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-plane-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('seat plane', () => {
  afterEach(() => {
    delete process.env.AUTOMATON_MODEL
    delete process.env.AUTOMATON_MOUTH_MODEL
    delete process.env.AUTOMATON_JOB_MODEL
  })

  test('missing file is the default OpenRouter id', () => {
    const home = tmpHome()
    expect(readPlane(home).model).toBe(DEFAULT_SEAT_MODEL)
    expect(seatModel(home)).toBe(DEFAULT_SEAT_MODEL)
    rmSync(home, { recursive: true, force: true })
  })

  test('writePlane is the shared mouth and job pin', () => {
    const home = tmpHome()
    writePlane({ model: 'openai/gpt-4.1-mini' }, home)
    expect(readPlane(home).model).toBe('openai/gpt-4.1-mini')
    expect(mouthModel(home)).toBe('openai/gpt-4.1-mini')
    expect(jobModel(home)).toBe('openai/gpt-4.1-mini')
    rmSync(home, { recursive: true, force: true })
  })

  test('blank parse falls back to the default id', () => {
    expect(parsePlane({ model: '  ' }).model).toBe(DEFAULT_SEAT_MODEL)
  })

  test('AUTOMATON_MODEL overrides the file for both seats', () => {
    const home = tmpHome()
    writePlane({ model: 'openai/gpt-4.1-mini' }, home)
    process.env.AUTOMATON_MODEL = 'openai/gpt-4o'
    expect(seatModel(home)).toBe('openai/gpt-4o')
    expect(mouthModel(home)).toBe('openai/gpt-4o')
    expect(jobModel(home)).toBe('openai/gpt-4o')
    rmSync(home, { recursive: true, force: true })
  })

  test('mouth env does not move the job pin', () => {
    const home = tmpHome()
    process.env.AUTOMATON_MOUTH_MODEL = 'openai/gpt-4o'
    expect(mouthModel(home)).toBe('openai/gpt-4o')
    expect(jobModel(home)).toBe(DEFAULT_SEAT_MODEL)
    rmSync(home, { recursive: true, force: true })
  })

  test('bun test does not inherit the live plane pin', () => {
    const prev = process.env.AUTOMATON_HOME
    delete process.env.AUTOMATON_HOME
    delete process.env.AUTOMATON_MODEL
    expect(seatModel()).toBe(DEFAULT_SEAT_MODEL)
    if (prev === undefined) delete process.env.AUTOMATON_HOME
    else process.env.AUTOMATON_HOME = prev
  })
})
