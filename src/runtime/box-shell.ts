import { parseBoxShellIntent, type BoxShellIntent, type JobHandle } from '../domain'
import { boxExecAsync, boxStatus, type BoxSeams } from './box'

export function boxShellArgv(intent: BoxShellIntent): { argv: string[]; user?: string } {
  if (intent.kind === 'which') {
    return { argv: ['sh', '-c', 'command -v "$1"', 'box-which', intent.name] }
  }
  return {
    user: 'root',
    argv: [
      'sh',
      '-c',
      'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y --no-install-recommends "$1"',
      'box-apt',
      intent.name,
    ],
  }
}

export function boxShellSpoken(
  intent: BoxShellIntent,
  result: { status: number; text: string },
): { ok: boolean; spoken: string } {
  if (intent.kind === 'which') {
    const line =
      result.text
        .trim()
        .split('\n')
        .map((row) => row.trim())
        .find((row) => row.length > 0) ?? ''
    if (result.status === 0 && line && !/not found/i.test(line)) {
      return { ok: true, spoken: `${intent.name} is on the computer at ${line}.` }
    }
    return { ok: true, spoken: `${intent.name} is not on PATH on the computer.` }
  }
  if (result.status === 0) {
    return { ok: true, spoken: `Installed ${intent.name} on the computer.` }
  }
  return { ok: false, spoken: `Could not install ${intent.name} on the computer.` }
}

export function runBoxShell(
  job: JobHandle,
  seams: BoxSeams = {},
): Promise<{ ok: boolean; spoken: string }> {
  const intent = parseBoxShellIntent(job.goal)
  if (!intent) {
    return Promise.resolve({
      ok: false,
      spoken: 'I can check PATH or apt-install a package on the computer.',
    })
  }
  const status = boxStatus(undefined, seams)
  if (status.docker === 'missing' || !status.running) {
    return Promise.resolve({ ok: false, spoken: 'The computer is not running.' })
  }
  const mapped = boxShellArgv(intent)
  return new Promise((resolve) => {
    boxExecAsync(
      mapped.argv,
      {},
      (result) => resolve(boxShellSpoken(intent, result)),
      seams,
      {
        user: mapped.user,
        timeoutMs: intent.kind === 'install' ? 120_000 : 45_000,
      },
    )
  })
}
