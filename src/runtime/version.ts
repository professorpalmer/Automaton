import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { automatonHome } from './keys'
import { readUpdateState, writeUpdateState } from './updates'

export type ReleaseOffer = {
  installed: string
  latestTag: string
  behind: boolean
}

export type ReleaseRun = (argv: string[], cwd: string) => { status: number; stdout: string; stderr: string }

export type ReleaseSeams = {
  run?: ReleaseRun
  cwd?: string
  home?: string
  /** Test seam — skip gh when provided. Return null to simulate unreachable. */
  fetchTag?: () => string | null
}

const PLIST_REL = join('macos', 'Automaton.app', 'Contents', 'Info.plist')
const DEFAULT_REPO = 'professorpalmer/Automaton'

function root(cwd?: string): string {
  return cwd ?? process.cwd()
}

function readJsonVersion(path: string): string {
  if (!existsSync(path)) return ''
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version.trim() : ''
  } catch {
    return ''
  }
}

/** Installed app version from package.json (source of truth for chrome). */
export function readInstalledVersion(cwd?: string): string {
  return readJsonVersion(join(root(cwd), 'package.json'))
}

/** CFBundleShortVersionString from the macOS Info.plist wrapper. */
export function readPlistVersion(cwd?: string): string {
  const path = join(root(cwd), PLIST_REL)
  if (!existsSync(path)) return ''
  try {
    const text = readFileSync(path, 'utf8')
    const match = text.match(
      /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>([^<]*)<\/string>/,
    )
    return match?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

/** True when package.json and Info.plist short versions match (both non-empty). */
export function versionsAligned(cwd?: string): boolean {
  const pkg = readInstalledVersion(cwd)
  const plist = readPlistVersion(cwd)
  if (!pkg || !plist) return false
  return normalizeSemver(pkg) === normalizeSemver(plist)
}

/** Strip a leading `v` / `V` for compare / display helpers. */
export function normalizeSemver(raw: string): string {
  return raw.trim().replace(/^[vV]/, '')
}

type SemverParts = { major: number; minor: number; patch: number; rest: string }

export function parseSemver(raw: string): SemverParts | null {
  const cleaned = normalizeSemver(raw)
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    rest: match[4] ?? '',
  }
}

/** Negative if a < b, 0 if equal, positive if a > b. Non-semver sorts as behind when other parses. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left && !right) return normalizeSemver(a).localeCompare(normalizeSemver(b))
  if (!left) return -1
  if (!right) return 1
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  return left.rest.localeCompare(right.rest)
}

export function isSemverBehind(installed: string, latestTag: string): boolean {
  if (!installed.trim() || !latestTag.trim()) return false
  return compareSemver(installed, latestTag) < 0
}

function exec(argv: string[], cwd: string, seams: ReleaseSeams, timeout = 20_000) {
  if (seams.run) return seams.run(argv, cwd)
  const result = spawnSync(argv[0] ?? 'gh', argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GH_PROMPT_DISABLED: '1',
    },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function parseTagName(stdout: string): string {
  try {
    const raw = JSON.parse(stdout) as { tagName?: unknown }
    return typeof raw.tagName === 'string' ? raw.tagName.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Compare installed package version to GitHub Latest release.
 * Returns null when GitHub is unreachable — never invents “up to date”.
 */
export function checkLatestRelease(seams: ReleaseSeams = {}): ReleaseOffer | null {
  const cwd = root(seams.cwd)
  const installed = readInstalledVersion(cwd)
  if (!installed) return null

  let latestTag = ''
  if (seams.fetchTag) {
    const tag = seams.fetchTag()
    if (tag == null) return null
    latestTag = tag.trim()
  } else {
    const viewed = exec(
      ['gh', 'release', 'view', '--repo', DEFAULT_REPO, '--json', 'tagName'],
      cwd,
      seams,
    )
    if (viewed.status !== 0) return null
    latestTag = parseTagName(viewed.stdout)
  }
  if (!latestTag) return null

  return {
    installed,
    latestTag,
    behind: isSemverBehind(installed, latestTag),
  }
}

export function readDismissedRelease(home = automatonHome()): string {
  return readUpdateState(home).dismissedRelease ?? ''
}

/** Persist a dismissed latest release tag (parallel to dismissUpdate sha). */
export function dismissRelease(tag: string, home = automatonHome()): void {
  const tip = tag.trim()
  if (!tip) return
  writeUpdateState({ dismissedRelease: tip }, home)
}

export function shouldOfferRelease(offer: ReleaseOffer | null, dismissed = ''): boolean {
  if (!offer || !offer.behind) return false
  return normalizeSemver(offer.latestTag) !== normalizeSemver(dismissed)
}

/** Settings / chrome summary — soft-fail latest when GitHub is unreachable. */
export function aboutVersionLines(seams: ReleaseSeams = {}): {
  installed: string
  plist: string
  aligned: boolean
  latestLine: string
} {
  const cwd = root(seams.cwd)
  const installed = readInstalledVersion(cwd) || 'unknown'
  const plist = readPlistVersion(cwd)
  const aligned = versionsAligned(cwd)
  const release = checkLatestRelease(seams)
  let latestLine = "Couldn't check"
  if (release) {
    latestLine = release.behind
      ? `${release.latestTag} (update available)`
      : release.latestTag
  }
  return { installed, plist, aligned, latestLine }
}
