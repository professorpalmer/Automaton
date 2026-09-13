import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  ensureHomeCheckout,
  expectedProjectsPath,
  remoteMatches,
} from '../src/runtime/home'

describe('home checkout ensure', () => {
  test('expectedProjectsPath maps owner/repo and bare name', () => {
    expect(expectedProjectsPath('example/Puppetmaster', '/tmp/Projects')).toBe(
      join('/tmp/Projects', 'Puppetmaster'),
    )
    expect(expectedProjectsPath('Marionette', '/tmp/Projects')).toBe(join('/tmp/Projects', 'Marionette'))
    expect(expectedProjectsPath('')).toBeNull()
  })

  test('remoteMatches normalizes github https and ssh', () => {
    expect(
      remoteMatches('git@github.com:example/Puppetmaster.git', 'https://github.com/example/Puppetmaster'),
    ).toBe(true)
    expect(
      remoteMatches(
        'https://github.com/example/Puppetmaster.git',
        'ssh://git@github.com/example/Puppetmaster',
      ),
    ).toBe(true)
    expect(
      remoteMatches('https://github.com/example/Puppetmaster', 'https://github.com/other/Puppetmaster'),
    ).toBe(false)
  })

  test('reuses existing checkout when remote matches', () => {
    const root = '/tmp/Projects'
    const path = join(root, 'Puppetmaster')
    let cloned = false
    const result = ensureHomeCheckout(
      { slug: 'example/Puppetmaster', url: 'https://github.com/example/Puppetmaster' },
      {
        projectsRoot: root,
        productRoot: '/tmp/Automaton',
        exists: (p) => p === path,
        isGit: (p) => p === path,
        readOrigin: () => 'git@github.com:example/Puppetmaster.git',
        clone: () => {
          cloned = true
          return { ok: true }
        },
      },
    )
    expect(result).toEqual({ ok: true, path, cloned: false })
    expect(cloned).toBe(false)
  })

  test('clones when missing and github url is given', () => {
    const root = '/tmp/Projects'
    const path = join(root, 'Puppetmaster')
    const calls: { url: string; path: string }[] = []
    const result = ensureHomeCheckout(
      { slug: 'example/Puppetmaster', url: 'https://github.com/example/Puppetmaster' },
      {
        projectsRoot: root,
        productRoot: '/tmp/Automaton',
        exists: () => false,
        isGit: () => false,
        clone: (url, dest) => {
          calls.push({ url, path: dest })
          return { ok: true }
        },
        mkdir: () => {},
      },
    )
    expect(result.ok).toBe(true)
    expect(result.path).toBe(path)
    expect(result.cloned).toBe(true)
    expect(result.spoken).toBe('Cloning example/Puppetmaster…')
    expect(calls).toEqual([{ url: 'https://github.com/example/Puppetmaster', path }])
  })

  test('wrong remote is a Need', () => {
    const root = '/tmp/Projects'
    const path = join(root, 'Puppetmaster')
    const result = ensureHomeCheckout(
      { slug: 'example/Puppetmaster', url: 'https://github.com/example/Puppetmaster' },
      {
        projectsRoot: root,
        productRoot: '/tmp/Automaton',
        exists: (p) => p === path,
        isGit: (p) => p === path,
        readOrigin: () => 'https://github.com/other/Puppetmaster',
        clone: () => ({ ok: true }),
      },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different remote')
  })

  test('missing without url is a Need', () => {
    const result = ensureHomeCheckout(
      { slug: 'Puppetmaster' },
      {
        projectsRoot: '/tmp/Projects',
        productRoot: '/tmp/Automaton',
        exists: () => false,
        isGit: () => false,
        clone: () => ({ ok: true }),
      },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Need a local checkout at ~/Projects/Puppetmaster.')
  })

  test('refuses productRoot', () => {
    const product = '/tmp/Automaton'
    const result = ensureHomeCheckout(
      { slug: 'Automaton', url: 'https://github.com/example/Automaton' },
      {
        projectsRoot: '/tmp',
        productRoot: product,
        exists: () => false,
        isGit: () => false,
        clone: () => ({ ok: true }),
        mkdir: () => {},
      },
    )
    // expected path is /tmp/Automaton when projectsRoot=/tmp and slug Automaton
    expect(result.ok).toBe(false)
    expect(result.error).toContain('refusing')
  })

  test('exists non-git is a Need (no clobber)', () => {
    const root = '/tmp/Projects'
    const path = join(root, 'Puppetmaster')
    let cloned = false
    const result = ensureHomeCheckout(
      { slug: 'example/Puppetmaster', url: 'https://github.com/example/Puppetmaster' },
      {
        projectsRoot: root,
        productRoot: '/tmp/Automaton',
        exists: (p) => p === path,
        isGit: () => false,
        clone: () => {
          cloned = true
          return { ok: true }
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not a git checkout')
    expect(cloned).toBe(false)
  })

  test('clone failure is a Need with stderr snippet', () => {
    const result = ensureHomeCheckout(
      { slug: 'example/Puppetmaster', url: 'https://github.com/example/Puppetmaster' },
      {
        projectsRoot: '/tmp/Projects',
        productRoot: '/tmp/Automaton',
        exists: () => false,
        isGit: () => false,
        mkdir: () => {},
        clone: () => ({ ok: false, stderr: 'Authentication failed\nmore' }),
      },
    )
    expect(result.ok).toBe(false)
    expect(result.spoken).toBe('Cloning example/Puppetmaster…')
    expect(result.error).toBe('Need: Authentication failed')
  })
})
