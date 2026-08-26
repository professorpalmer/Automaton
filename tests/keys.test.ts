import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  adoptMarionetteOpenRouterKey,
  listOpenRouterKeys,
  resolveOpenRouterKey,
} from '../src/runtime/keys.ts'

describe('openrouter key resolve', () => {
  test('env wins, then automaton, then marionette state over legacy', () => {
    const root = join(tmpdir(), `automaton-keys-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    const automatonPath = join(root, 'automaton-keys.json')
    const marionettePath = join(root, 'marionette-legacy.json')
    const marionetteStatePath = join(root, 'marionette-state.json')
    writeFileSync(marionettePath, `${JSON.stringify({ openrouter: 'sk-or-legacy' })}\n`)
    writeFileSync(marionetteStatePath, `${JSON.stringify({ openrouter: 'sk-or-state' })}\n`)
    expect(
      resolveOpenRouterKey({
        env: {},
        automatonPath,
        marionettePath,
        marionetteStatePath,
      }).source,
    ).toBe('marionette')
    expect(
      listOpenRouterKeys({
        env: {},
        automatonPath,
        marionettePath,
        marionetteStatePath,
      }).map((row) => row.source),
    ).toEqual(['marionette', 'marionette'])
    const adopted = adoptMarionetteOpenRouterKey({
      env: { OPENROUTER_API_KEY: 'sk-or-env' },
      automatonPath,
      marionettePath,
      marionetteStatePath,
    })
    expect(adopted.copied).toBe(true)
    expect(JSON.parse(readFileSync(automatonPath, 'utf8')).openrouter).toBe('sk-or-state')
    expect(
      resolveOpenRouterKey({ env: {}, automatonPath, marionettePath, marionetteStatePath })
        .source,
    ).toBe('automaton')
    expect(
      resolveOpenRouterKey({
        env: { OPENROUTER_API_KEY: 'sk-or-env' },
        automatonPath,
        marionettePath,
        marionetteStatePath,
      }).source,
    ).toBe('env')
  })

  test('adopt replaces an automaton copy of the stale legacy key', () => {
    const root = join(tmpdir(), `automaton-keys-stale-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    const automatonPath = join(root, 'automaton-keys.json')
    const marionettePath = join(root, 'marionette-legacy.json')
    const marionetteStatePath = join(root, 'marionette-state.json')
    writeFileSync(marionettePath, `${JSON.stringify({ openrouter: 'sk-or-legacy' })}\n`)
    writeFileSync(marionetteStatePath, `${JSON.stringify({ openrouter: 'sk-or-state' })}\n`)
    writeFileSync(automatonPath, `${JSON.stringify({ openrouter: 'sk-or-legacy' })}\n`)
    const adopted = adoptMarionetteOpenRouterKey({
      env: {},
      automatonPath,
      marionettePath,
      marionetteStatePath,
    })
    expect(adopted.copied).toBe(true)
    expect(JSON.parse(readFileSync(automatonPath, 'utf8')).openrouter).toBe('sk-or-state')
  })

  test('AUTOMATON_HOME does not pick up default marionette files', () => {
    const home = join(tmpdir(), `automaton-keys-home-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'keys.json'), `${JSON.stringify({ openrouter: 'sk-or-home-only' })}\n`)
    const prevHome = process.env.AUTOMATON_HOME
    const prevKey = process.env.OPENROUTER_API_KEY
    process.env.AUTOMATON_HOME = home
    delete process.env.OPENROUTER_API_KEY
    try {
      expect(listOpenRouterKeys().map((row) => row.source)).toEqual(['automaton'])
      expect(resolveOpenRouterKey().key).toBe('sk-or-home-only')
    } finally {
      if (prevHome === undefined) delete process.env.AUTOMATON_HOME
      else process.env.AUTOMATON_HOME = prevHome
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prevKey
    }
  })
})
