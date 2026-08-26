import { spawnSync } from 'node:child_process'

export type DoctorReport = {
  ok: boolean
  python: string
  puppetmaster: string
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

export function doctorPuppetmaster(): DoctorReport {
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
      return {
        ok: true,
        python: [command, ...args].join(' '),
        puppetmaster: 'reachable',
      }
    }
  }
  return {
    ok: false,
    python: 'puppetmaster | python -m puppetmaster',
    puppetmaster: 'failed',
    error: last.slice(0, 800),
  }
}
