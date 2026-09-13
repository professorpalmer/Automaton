import { spawnSync } from 'node:child_process'
import { boxStatus, computerLabel } from './box'
import { doctorLiveInstance, type LiveInstanceDoctor, type LiveInstanceSeams } from './live-instance'

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

function withLiveInstance(
  base: Omit<DoctorReport, 'liveInstance' | 'liveInstancePids' | 'liveInstanceNote'>,
  liveSeams?: LiveInstanceSeams,
): DoctorReport {
  const live: LiveInstanceDoctor = doctorLiveInstance(liveSeams ?? {})
  return {
    ...base,
    liveInstance: live.status,
    liveInstancePids: live.pids.length ? live.pids : undefined,
    liveInstanceNote: live.message,
  }
}

export function doctorPuppetmaster(liveSeams?: LiveInstanceSeams): DoctorReport {
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
      return withLiveInstance(
        {
          ok: true,
          python: [command, ...args].join(' '),
          puppetmaster: 'reachable',
          chrome,
          chromePath,
          computer: computerLabel(computer),
        },
        liveSeams,
      )
    }
  }
  const { computer, chrome, chromePath } = chromeReport()
  return withLiveInstance(
    {
      ok: false,
      python: 'puppetmaster | python -m puppetmaster',
      puppetmaster: 'failed',
      chrome,
      chromePath,
      computer: computerLabel(computer),
      error: last.slice(0, 800),
    },
    liveSeams,
  )
}
