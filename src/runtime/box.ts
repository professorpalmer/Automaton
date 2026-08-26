import { spawn, spawnSync } from 'node:child_process'
import { BOX_IMAGE, BOX_NAME, computerRoot, desktopsRoot } from './computer'
import { automatonHome } from './keys'

export type BoxKind = 'local-docker'

export type BoxStatus = {
  kind: BoxKind
  name: string
  running: boolean
  docker: 'found' | 'missing'
}

export type BoxSeams = {
  docker?: (args: string[]) => { status: number; text: string }
}

function defaultDocker(args: string[]): { status: number; text: string } {
  if (process.env.BUN_TEST && !process.env.AUTOMATON_DOCKER?.trim()) {
    return { status: 1, text: 'docker disabled in tests' }
  }
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 45_000,
    env: process.env,
  })
  if (result.error && /ENOENT|not found/i.test(String(result.error))) {
    return { status: 127, text: String(result.error) }
  }
  return {
    status: result.status ?? 1,
    text: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

function runDocker(args: string[], seams: BoxSeams = {}): { status: number; text: string } {
  return (seams.docker ?? defaultDocker)(args)
}

export function boxName(): string {
  return BOX_NAME
}

export function boxMounts(home = automatonHome()): { desktops: string; home: string } {
  return {
    desktops: desktopsRoot(home),
    home: computerRoot(home),
  }
}

export function boxRunArgv(home = automatonHome()): string[] {
  const mounts = boxMounts(home)
  return [
    'run',
    '-d',
    '--name',
    BOX_NAME,
    '-v',
    `${mounts.desktops}:/home/box/desktops`,
    '-v',
    `${mounts.home}:/home/box/host`,
    '--shm-size',
    '1g',
    BOX_IMAGE,
  ]
}

export function boxStatus(home = automatonHome(), seams: BoxSeams = {}): BoxStatus {
  const inspect = runDocker(['inspect', '-f', '{{.State.Running}}', BOX_NAME], seams)
  if (inspect.status === 127) {
    return { kind: 'local-docker', name: BOX_NAME, running: false, docker: 'missing' }
  }
  const running = inspect.status === 0 && inspect.text.includes('true')
  return { kind: 'local-docker', name: BOX_NAME, running, docker: 'found' }
}

function boxHasScreen(seams: BoxSeams = {}): boolean {
  const result = runDocker(['exec', BOX_NAME, 'which', 'automaton-screen'], seams)
  return result.status === 0 && result.text.includes('automaton-screen')
}

function boxImageMatches(seams: BoxSeams = {}): boolean {
  const wanted = runDocker(['image', 'inspect', '-f', '{{.Id}}', BOX_IMAGE], seams)
  const have = runDocker(['inspect', '-f', '{{.Image}}', BOX_NAME], seams)
  if (wanted.status !== 0 || have.status !== 0) return true
  const image = wanted.text.trim()
  const container = have.text.trim()
  if (!image || !container) return true
  return image === container
}

function boxNeedsRecreate(seams: BoxSeams = {}): boolean {
  return !boxHasScreen(seams) || !boxImageMatches(seams)
}

function recreateBox(home: string, seams: BoxSeams = {}): BoxStatus {
  runDocker(['rm', '-f', BOX_NAME], seams)
  runDocker(boxRunArgv(home), seams)
  return boxStatus(home, seams)
}

export function ensureBox(home = automatonHome(), seams: BoxSeams = {}): BoxStatus {
  const current = boxStatus(home, seams)
  if (current.docker === 'missing') return current
  if (current.running) {
    if (!boxNeedsRecreate(seams)) return current
    return recreateBox(home, seams)
  }
  const start = runDocker(['start', BOX_NAME], seams)
  if (start.status === 0) {
    const up = boxStatus(home, seams)
    if (up.running && !boxNeedsRecreate(seams)) return up
    return recreateBox(home, seams)
  }
  runDocker(boxRunArgv(home), seams)
  return boxStatus(home, seams)
}

export function sleepBox(home = automatonHome(), seams: BoxSeams = {}): BoxStatus {
  runDocker(['stop', BOX_NAME], seams)
  return boxStatus(home, seams)
}

export function boxExec(
  argv: string[],
  env: Record<string, string> = {},
  seams: BoxSeams = {},
): { status: number; text: string } {
  const flags = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  return runDocker(['exec', ...flags, BOX_NAME, ...argv], seams)
}

function execArgv(argv: string[], env: Record<string, string> = {}): string[] {
  const flags = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  return ['exec', ...flags, BOX_NAME, ...argv]
}

/** Fire-and-forget docker exec. The GPUI tick loop must not wait on xdotool. */
export function boxSpawn(
  argv: string[],
  env: Record<string, string> = {},
  seams: BoxSeams = {},
): boolean {
  if (seams.docker) return boxExec(argv, env, seams).status === 0
  if (process.env.BUN_TEST && !process.env.AUTOMATON_DOCKER?.trim()) return false
  try {
    const child = spawn('docker', execArgv(argv, env), { stdio: 'ignore', detached: true, env: process.env })
    child.unref()
    return Boolean(child.pid)
  } catch {
    return false
  }
}

export function boxExecAsync(
  argv: string[],
  env: Record<string, string> = {},
  done: (result: { status: number; text: string }) => void,
  seams: BoxSeams = {},
): void {
  if (seams.docker) {
    done(boxExec(argv, env, seams))
    return
  }
  if (process.env.BUN_TEST && !process.env.AUTOMATON_DOCKER?.trim()) {
    done({ status: 1, text: 'docker disabled in tests' })
    return
  }
  let text = ''
  let settled = false
  const finish = (status: number, extra = '') => {
    if (settled) return
    settled = true
    done({ status, text: `${text}${extra}` })
  }
  try {
    const child = spawn('docker', execArgv(argv, env), { env: process.env })
    child.stdout?.on('data', (chunk) => {
      text += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      text += String(chunk)
    })
    child.on('close', (status) => finish(status ?? 1))
    child.on('error', (error) => finish(1, String(error)))
  } catch (error) {
    finish(1, String(error))
  }
}

export function computerLabel(status: BoxStatus): string {
  if (status.running) return 'One local Docker · running'
  if (status.docker === 'missing') return 'One local Docker · Docker missing'
  return 'One local Docker · idle on disk'
}
