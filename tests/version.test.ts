import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  checkLatestRelease,
  compareSemver,
  dismissRelease,
  isSemverBehind,
  normalizeSemver,
  readDismissedRelease,
  readInstalledVersion,
  readPlistVersion,
  shouldOfferRelease,
  versionsAligned,
} from '../src/runtime/version'
import { dismissUpdate, readDismissedSha } from '../src/runtime/updates'
import { doctorPuppetmaster } from '../src/runtime/doctor'

function tmpTree(pkg: string, plist?: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'automaton-version-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'automaton', version: pkg }, null, 2) + '\n')
  if (plist !== null) {
    const dir = join(root, 'macos', 'Automaton.app', 'Contents')
    mkdirSync(dir, { recursive: true })
    const short = plist ?? pkg
    writeFileSync(
      join(dir, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${short}</string>
  <key>CFBundleVersion</key>
  <string>${short}</string>
</dict>
</plist>
`,
    )
  }
  return root
}

describe('version chrome', () => {
  test('reads package and plist versions and detects align/drift', () => {
    const aligned = tmpTree('0.2.0', '0.2.0')
    expect(readInstalledVersion(aligned)).toBe('0.2.0')
    expect(readPlistVersion(aligned)).toBe('0.2.0')
    expect(versionsAligned(aligned)).toBe(true)
    rmSync(aligned, { recursive: true, force: true })

    const drift = tmpTree('0.2.0', '0.1.0')
    expect(versionsAligned(drift)).toBe(false)
    rmSync(drift, { recursive: true, force: true })
  })

  test('semver helpers strip v and order behind', () => {
    expect(normalizeSemver('v0.2.0')).toBe('0.2.0')
    expect(compareSemver('0.2.0', 'v0.2.0')).toBe(0)
    expect(isSemverBehind('0.2.0', 'v0.3.0')).toBe(true)
    expect(isSemverBehind('0.2.0', '0.2.0')).toBe(false)
    expect(isSemverBehind('0.3.0', '0.2.9')).toBe(false)
  })
})

describe('release check', () => {
  test('reports behind when latest tag is newer', () => {
    const root = tmpTree('0.2.0')
    const home = mkdtempSync(join(tmpdir(), 'automaton-home-'))
    const offer = checkLatestRelease({
      cwd: root,
      home,
      fetchTag: () => 'v0.3.0',
    })
    expect(offer).toEqual({ installed: '0.2.0', latestTag: 'v0.3.0', behind: true })
    expect(shouldOfferRelease(offer, '')).toBe(true)
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test('unreachable soft-fails to null (never invents up to date)', () => {
    const root = tmpTree('0.2.0')
    expect(checkLatestRelease({ cwd: root, fetchTag: () => null })).toBeNull()
    expect(
      checkLatestRelease({
        cwd: root,
        run: () => ({ status: 1, stdout: '', stderr: 'offline' }),
      }),
    ).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })

  test('dismissRelease suppresses the same tag and preserves git dismiss', () => {
    const home = mkdtempSync(join(tmpdir(), 'automaton-home-'))
    const root = tmpTree('0.2.0')
    const offer = checkLatestRelease({ cwd: root, home, fetchTag: () => 'v0.3.0' })
    expect(offer?.behind).toBe(true)
    dismissUpdate('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', home)
    dismissRelease(offer!.latestTag, home)
    expect(readDismissedRelease(home)).toBe('v0.3.0')
    expect(readDismissedSha(home)).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(shouldOfferRelease(offer, readDismissedRelease(home))).toBe(false)
    expect(shouldOfferRelease(offer, 'v0.3.0')).toBe(false)
    expect(shouldOfferRelease(offer, '0.3.0')).toBe(false)
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test('even with latest does not offer', () => {
    const root = tmpTree('0.2.0')
    const offer = checkLatestRelease({ cwd: root, fetchTag: () => 'v0.2.0' })
    expect(offer?.behind).toBe(false)
    expect(shouldOfferRelease(offer, '')).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('doctor version WARN', () => {
  test('WARNs when package ≠ plist', () => {
    const drift = tmpTree('0.2.0', '0.1.0')
    const report = doctorPuppetmaster({ listPs: () => '', repoRoot: drift }, drift)
    expect(report.version).toBe('warn')
    expect(report.versionNote).toContain('0.2.0')
    expect(report.versionNote).toContain('0.1.0')
    rmSync(drift, { recursive: true, force: true })
  })

  test('ok when package and plist match', () => {
    const aligned = tmpTree('0.2.0', '0.2.0')
    const report = doctorPuppetmaster({ listPs: () => '', repoRoot: aligned }, aligned)
    expect(report.version).toBe('ok')
    rmSync(aligned, { recursive: true, force: true })
  })
})
