import { spawnSync } from 'node:child_process'
import { boxStatus, computerLabel } from './box'
import {
  doctorCloudOrigin,
  probeCloudPresence,
  type CloudPresence,
} from './cloud-origin'
import { doctorLiveInstance, type LiveInstanceDoctor, type LiveInstanceSeams } from './live-instance'
import { doctorIdleCpu, type IdleCpuDoctor } from './idle-health'
import { readInstalledVersion, readPlistVersion, versionsAligned } from './version'

export type DoctorReport = {
  ok: boolean
  python: string
  puppetmaster: string
  chrome: 'found' | 'missing'
  chromePath?: string
  computer: string
  /** Live-instance / zombie check — WARN only; does not alone flip ok false. */
  liveInstance: 'ok' | 'warn'
  liveInstancePids?: number[]
  liveInstanceNote?: string
  /** package.json vs Info.plist — WARN only when they drift. */
  version: 'ok' | 'warn'
  versionNote?: string
  packageVersion?: string
  plistVersion?: string
  /** Idle CPU checklist / optional live sample — WARN/skip only; never flips ok alone. */
  idleCpu: 'ok' | 'warn' | 'skip'
  idleCpuNote?: string
  /**
   * Optional cloud-agent / Origin — WARN/parked only; never flips ok alone.
   * Live probe when AUTOMATON_CLOUD_PROBE=1; otherwise parked checklist note.
   */
  cloud: 'ok' | 'warn' | 'parked'
  cloudNote?: string
  error?: string
}

function run(command: string, args: string[]): { status: number | null; text: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 20_000,
    env: process.env,
  })
  return {
    status: result.status,
    text: `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
  }
}

function chromeReport() {
  const computer = boxStatus()
  return {
    computer,
    chrome: (computer.running ? 'found' : 'missing') as 'found' | 'missing',
    chromePath: computer.running ? 'box' : undefined,
  }
}

function versionDoctor(cwd?: string): Pick<DoctorReport, 'version' | 'versionNote' | 'packageVersion' | 'plistVersion'> {
  const packageVersion = readInstalledVersion(cwd) || undefined
  const plistVersion = readPlistVersion(cwd) || undefined
  if (versionsAligned(cwd)) {
    return { version: 'ok', packageVersion, plistVersion }
  }
  const pkg = packageVersion ?? '(missing)'
  const plist = plistVersion ?? '(missing)'
  return {
    version: 'warn',
    packageVersion,
    plistVersion,
    versionNote: `package.json ${pkg} ≠ Info.plist CFBundleShortVersionString ${plist}`,
  }
}

function shouldLiveCloudProbe(): boolean {
  return (
    process.env.AUTOMATON_CLOUD_PROBE === '1' &&
    process.env.CI !== 'true' &&
    process.env.AUTOMATON_SKIP_CLOUD_PROBE !== '1'
  )
}

export type DoctorExtras = {
  liveSeams?: LiveInstanceSeams
  cwd?: string
  idle?: IdleCpuDoctor
  /** Injected cloud presence (tests). When omitted, checklist note or live probe. */
  cloud?: CloudPresence
}

function withExtras(
  base: Omit<
    DoctorReport,
    | 'liveInstance'
    | 'liveInstancePids'
    | 'liveInstanceNote'
    | 'version'
    | 'versionNote'
    | 'packageVersion'
    | 'plistVersion'
    | 'idleCpu'
    | 'idleCpuNote'
    | 'cloud'
    | 'cloudNote'
  >,
  extras: DoctorExtras = {},
): DoctorReport {
  const live: LiveInstanceDoctor = doctorLiveInstance(extras.liveSeams ?? {})
  const ver = versionDoctor(extras.cwd)
  const idleCpu = extras.idle ?? doctorIdleCpu()
  const cloudDoctor = doctorCloudOrigin(extras.cloud)
  return {
    ...base,
    liveInstance: live.status,
    liveInstancePids: live.pids.length ? live.pids : undefined,
    liveInstanceNote: live.message,
    ...ver,
    idleCpu: idleCpu.status,
    idleCpuNote: idleCpu.note,
    cloud: cloudDoctor.status,
    cloudNote: cloudDoctor.note,
  }
}

export function doctorPuppetmaster(liveSeams?: LiveInstanceSeams, cwd?: string): DoctorReport {
  return doctorPuppetmasterWith({ liveSeams, cwd })
}

/** Async doctor when a live cloud probe is requested (AUTOMATON_CLOUD_PROBE=1). */
export async function doctorPuppetmasterAsync(extras: DoctorExtras = {}): Promise<DoctorReport> {
  let cloud = extras.cloud
  if (!cloud && shouldLiveCloudProbe()) {
    cloud = await probeCloudPresence()
  }
  return doctorPuppetmasterWith({ ...extras, cloud })
}

export function doctorPuppetmasterWith(extras: DoctorExtras = {}): DoctorReport {
  const attempts: Array<[string, string[]]> = [
    ['puppetmaster', ['doctor']],
    ['python', ['-m', 'puppetmaster', 'doctor']],
    ['python3', ['-m', 'puppetmaster', 'doctor']],
  ]
  let last = ''
  for (const [command, args] of attempts) {
    const { status, text } = run(command, args)
    last = text
    if (status === 0 && /ok\s+python/.test(text)) {
      const { computer, chrome, chromePath } = chromeReport()
      return withExtras(
        {
          ok: true,
          python: [command, ...args].join(' '),
          puppetmaster: 'reachable',
          chrome,
          chromePath,
          computer: computerLabel(computer),
        },
        extras,
      )
    }
  }
  const { computer, chrome, chromePath } = chromeReport()
  return withExtras(
    {
      ok: false,
      python: 'puppetmaster | python -m puppetmaster',
      puppetmaster: 'failed',
      chrome,
      chromePath,
      computer: computerLabel(computer),
      error: last.slice(0, 800),
    },
    extras,
  )
}
