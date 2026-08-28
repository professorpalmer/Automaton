import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_SEAT_MODEL,
  jobModel,
  mouthModel,
  mouthModelFor,
  parsePlane,
  readPlane,
  seatBinding,
  seatModel,
  writePlane,
  writeSeatBinding,
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

  test('seatBinding roundtrip; missing seat falls back to default', () => {
    const home = tmpHome()
    writePlane({ model: 'openai/gpt-4.1-mini' }, home)
    writeSeatBinding('kernel', { model: 'x-ai/grok-4', effort: 'max', fast: false }, home)
    expect(seatBinding('kernel', home)).toEqual({
      model: 'x-ai/grok-4',
      effort: 'max',
      fast: false,
    })
    expect(seatBinding('staff', home)).toEqual({})
    expect(mouthModelFor('kernel', home)).toBe('x-ai/grok-4')
    expect(mouthModelFor('staff', home)).toBe('openai/gpt-4.1-mini')
    expect(mouthModel(home)).toBe('openai/gpt-4.1-mini')
    writePlane({ model: 'openai/gpt-4o-mini' }, home)
    expect(seatBinding('kernel', home).model).toBe('x-ai/grok-4')
    process.env.AUTOMATON_MODEL = 'openai/gpt-4o'
    expect(mouthModelFor('kernel', home)).toBe('openai/gpt-4o')
    process.env.AUTOMATON_MOUTH_MODEL = 'openai/gpt-4.1'
    expect(mouthModelFor('kernel', home)).toBe('openai/gpt-4.1')
    rmSync(home, { recursive: true, force: true })
  })
})
