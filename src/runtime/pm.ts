import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { sanitizeSpeak, type JobHandle } from '../domain'
import { automatonHome, listOpenRouterKeys } from './keys'
import { DEFAULT_SEAT_MODEL, jobModel } from './plane'

export const PRODUCT_ROOT = resolve(import.meta.dir, '../..')
export const JOB_ADAPTER = 'agentic'
export const JOB_PROVIDER = 'openrouter'
export const DEFAULT_JOB_MODEL = DEFAULT_SEAT_MODEL
export { jobModel }

export function jobRegistryId(model = jobModel()): string {
  return `${JOB_ADAPTER}/${model}`
}

export function jobRegistryPath(): string {
  return process.env.AUTOMATON_PM_MODELS_PATH?.trim() || join(automatonHome(), 'models.json')
}

export function ensureJobRegistry(path = jobRegistryPath()): string {
  mkdirSync(dirname(path), { recursive: true })
  const model = jobModel()
  const catalog = {
    schema_version: 1,
    models: [
      {
        id: jobRegistryId(model),
        adapter: JOB_ADAPTER,
        adapter_model_name: model,
        capability_score: 50,
        input_per_mtok_usd: 0.15,
        output_per_mtok_usd: 0.6,
        context_window: 128000,
        tags: ['tools', 'agentic', 'openrouter'],
        notes: '',
        enabled: true,
        disabled_reason: '',
        disabled_authority: '',
        retired: false,
        retirement_reason: '',
        retirement_authority: '',
        payload_defaults: { provider: JOB_PROVIDER },
        output_token_multiplier: 1.0,
        billing: 'api',
        role_scorecards: {},
        score_provenance: {},
      },
    ],
  }
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`)
  return path
}

const JOB_ID_RE = /job_id:\s*(job_[A-Za-z0-9]+)/
const BARE_JOB_RE = /\b(job_[A-Za-z0-9]{6,})\b/
const LAUNCHER_RE = /launcher_pid=(\d+)/
const TERMINAL = new Set(['complete', 'failed', 'stalled', 'cancelled'])

export type PmBin = { command: string; prefix: string[] }

export type StatusSnap = {
  job?: { id?: string; status?: string }
  delivery?: { successful?: boolean }
}

export function parseJobId(text: string): string | null {
  const labeled = text.match(JOB_ID_RE)
  if (labeled) return labeled[1]
  const bare = text.match(BARE_JOB_RE)
  return bare ? bare[1] : null
}

export function parseLauncherPid(text: string): number | undefined {
  const match = text.match(LAUNCHER_RE)
  if (!match) return undefined
  const pid = Number(match[1])
  return Number.isFinite(pid) ? pid : undefined
}

export type SpawnedPm = { pmJobId: string; launcherPid?: number }

export function jobOutcome(snap: StatusSnap): 'complete' | 'failed' | 'running' {
  const status = String(snap.job?.status ?? '')
  if (!TERMINAL.has(status)) return 'running'
  if (status !== 'complete') return 'failed'
  if (snap.delivery?.successful === false) return 'failed'
  return 'complete'
}

/** Finding/decision/gist text the mouth can speak. Hollow fallback `Done.` is a miss. */
export function substantiveSpokenFromRefs(refs: unknown): string | null {
  const list = Array.isArray(refs) ? refs : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = String(row.type ?? '')
    if (!/finding|decision|gist/i.test(type)) continue
    for (const key of ['claim', 'decision', 'why']) {
      const value = row[key]
      if (typeof value !== 'string' || !value.trim()) continue
      const spoken = sanitizeSpeak(value)
      if (spoken && spoken !== 'Done.') return spoken
    }
  }
  return null
}

export function spokenFromArtifactRefs(refs: unknown): string {
  const spoken = substantiveSpokenFromRefs(refs)
  if (spoken) return spoken
  const list = Array.isArray(refs) ? refs : []
  const failed = list.some((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    return String(row.type ?? '') === 'verification' && String(row.result ?? '') === 'failed'
  })
  return failed ? "Didn't land." : 'Done.'
}

export function assertSandboxCwd(workerCwd: string, productRoot = PRODUCT_ROOT): string {
  const worker = resolve(workerCwd)
  const product = resolve(productRoot)
  if (worker === product || worker.startsWith(product + sep)) {
    throw new Error('refusing worker cwd inside the Automaton checkout')
  }
  return worker
}

export function analyzeCwd(productRoot = PRODUCT_ROOT): string {
  return resolve(productRoot)
}

export function sandboxDir(localId: string): string {
  return join(homedir(), '.automaton', 'sandboxes', localId)
}

export function seedSandboxFromProduct(localId: string, productRoot = PRODUCT_ROOT): string {
  const root = sandboxDir(localId)
  if (existsSync(join(root, '.git'))) {
    return assertSandboxCwd(root, productRoot)
  }
  mkdirSync(join(homedir(), '.automaton', 'sandboxes'), { recursive: true })
  const branch = `automaton-sandbox-${localId}`
  runGit(['worktree', 'add', '-b', branch, root, 'HEAD'], productRoot, gitEnv())
  return assertSandboxCwd(root, productRoot)
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Automaton',
    GIT_AUTHOR_EMAIL: 'automaton@local',
    GIT_COMMITTER_NAME: 'Automaton',
    GIT_COMMITTER_EMAIL: 'automaton@local',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  }
}

function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
}

export function analyzePrompt(job: JobHandle): string {
  const owner = job.ownerAgentId
  return [
    `You are a Puppetmaster analysis worker for Automaton ${owner}.`,
    'Do not edit files. Do not print job ids.',
    'Produce one FINDING with a short claim the owner can speak aloud.',
    `Request: ${job.goal}`,
  ].join(' ')
}

export function analysisInstruction(goal: string): string {
  return [
    'Role: analysis',
    `Goal: ${goal}`,
    '',
    'Return structured findings with concrete file/function evidence. Do not modify files unless the user explicitly requested implementation. Return only Puppetmaster artifact JSON with an artifacts array.',
  ].join('\n')
}

export function writeAnalyzeConfig(input: {
  localId: string
  instruction: string
  workerCwd: string
  timeoutSeconds?: number
}): { configPath: string; goalPath: string } {
  const dir = join(homedir(), '.automaton', 'configs')
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, `${input.localId}.json`)
  const goalPath = join(dir, `${input.localId}.goal.txt`)
  const timeout = input.timeoutSeconds ?? 300
  const cwd = resolve(input.workerCwd)
  const config = {
    lease_seconds: 10,
    workers: [
      {
        role: 'analysis',
        instruction: input.instruction,
        adapter: JOB_ADAPTER,
        payload: agenticPayload({
          prompt: input.instruction,
          cwd,
          timeoutSeconds: timeout,
          mode: 'analyze',
        }),
      },
    ],
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(goalPath, input.instruction)
  return { configPath, goalPath }
}

export function implementPrompt(job: JobHandle): string {
  return [
    `You are a Puppetmaster implement worker for Automaton ${job.ownerAgentId}.`,
    'You are in an isolated git sandbox, not the live Automaton checkout.',
    'Implement the request. Do not print job ids.',
    `Request: ${job.goal}`,
  ].join(' ')
}

export function implementInstruction(job: JobHandle): string {
  return [
    'Role: implement',
    `Goal: ${implementPrompt(job)}`,
    '',
    'You are in an isolated git sandbox, not the live Automaton checkout.',
    'Implement the request. Do not print job ids.',
    'Leave the working tree with the intended changes.',
  ].join('\n')
}

export function writeImplementConfig(input: {
  localId: string
  instruction: string
  workerCwd: string
  timeoutSeconds?: number
}): { configPath: string; goalPath: string } {
  const workerCwd = assertSandboxCwd(input.workerCwd)
  const dir = join(homedir(), '.automaton', 'configs')
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, `${input.localId}.json`)
  const goalPath = join(dir, `${input.localId}.goal.txt`)
  const timeout = input.timeoutSeconds ?? 300
  const config = {
    lease_seconds: 10,
    workers: [
      {
        role: 'implement',
        instruction: input.instruction,
        adapter: JOB_ADAPTER,
        payload: agenticPayload({
          prompt: input.instruction,
          cwd: workerCwd,
          timeoutSeconds: timeout,
          mode: 'implement',
        }),
      },
    ],
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(goalPath, input.instruction)
  return { configPath, goalPath }
}

export function buildAnalyzeArgv(input: {
  configPath: string
  goalPath: string
  label: string
  launchKey: string
  timeoutSeconds?: number
}): string[] {
  return [
    '--emit-job-id-early',
    'run',
    '--config',
    input.configPath,
    '--goal-file',
    input.goalPath,
    '--timeout-seconds',
    String(input.timeoutSeconds ?? 300),
    '--label',
    input.label,
    '--worker-mode',
    'subprocess',
    '--disable-memory',
    '--launch-key',
    input.launchKey,
  ]
}

export function buildImplementArgv(input: {
  prompt: string
  workerCwd: string
  label: string
  model?: string
  timeoutSeconds?: number
}): string[] {
  const workerCwd = assertSandboxCwd(input.workerCwd)
  return [
    '--emit-job-id-early',
    JOB_ADAPTER,
    input.prompt,
    '--cwd',
    workerCwd,
    '--mode',
    'implement',
    '--provider',
    JOB_PROVIDER,
    '--model',
    input.model ?? jobModel(),
    '--label',
    input.label,
    '--timeout-seconds',
    String(input.timeoutSeconds ?? 300),
    '--disable-memory',
  ]
}

export function ownerLabel(job: JobHandle): string {
  if (job.kind === 'implement') return 'kernel implement request'
  if (job.ownerAgentId === 'research') return 'research look up'
  return 'kernel analyze request'
}

export function resolvePm(): PmBin {
  const override = process.env.AUTOMATON_PM_BIN?.trim()
  if (override) {
    const parts = override.split(/\s+/)
    return { command: parts[0], prefix: parts.slice(1) }
  }
  const attempts: PmBin[] = [
    { command: 'puppetmaster', prefix: [] },
    { command: 'python', prefix: ['-m', 'puppetmaster'] },
    { command: 'python3', prefix: ['-m', 'puppetmaster'] },
  ]
  for (const bin of attempts) {
    const probe = spawnSync(bin.command, [...bin.prefix, 'doctor'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: pmEnv(),
    })
    if (probe.status === 0) return bin
  }
  return attempts[0]
}

export function pmEnv(): NodeJS.ProcessEnv {
  const localBin = join(homedir(), '.local', 'bin')
  const path = process.env.PATH ?? ''
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: path.includes(localBin) ? path : `${localBin}:${path}`,
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    PYTHONUTF8: '1',
  }
  stampOpenRouterPool(env)
  env.PUPPETMASTER_MODELS_PATH = ensureJobRegistry()
  return env
}

function stampOpenRouterPool(env: NodeJS.ProcessEnv): void {
  for (let i = 2; i <= 9; i++) delete env[`OPENROUTER_API_KEY_${i}`]
  const keys = listOpenRouterKeys({ env: process.env })
  if (!keys.length) {
    delete env.OPENROUTER_API_KEY
    return
  }
  const rank: Record<string, number> = { automaton: 0, marionette: 1, env: 2 }
  const ordered = [...keys].sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9))
  env.OPENROUTER_API_KEY = ordered[0].key
  for (let i = 1; i < ordered.length && i < 9; i++) {
    env[`OPENROUTER_API_KEY_${i + 1}`] = ordered[i].key
  }
}

function agenticPayload(input: {
  prompt: string
  cwd: string
  timeoutSeconds: number
  mode: 'analyze' | 'implement'
}): Record<string, unknown> {
  const model = jobModel()
  const pinned = jobRegistryId(model)
  ensureJobRegistry()
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    cwd: input.cwd,
    timeout_seconds: input.timeoutSeconds,
    mode: input.mode,
    provider: JOB_PROVIDER,
    model,
    allowed_adapters: [JOB_ADAPTER],
    auto_route: false,
    pinned_model: pinned,
    router_model_id: pinned,
    pinned_adapter_model_name: model,
    disable_memory: true,
  }
  if (input.mode === 'analyze') {
    payload.read_only = true
    payload.sandbox = 'read-only'
    return payload
  }
  payload.implement = true
  payload.allow_dirty = true
  payload.allow_non_worktree = false
  return payload
}

export function spawnPm(argv: string[], productRoot = PRODUCT_ROOT) {
  const bin = resolvePm()
  return spawn(bin.command, [...bin.prefix, ...argv], {
    cwd: productRoot,
    env: pmEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function waitForJobId(
  child: ReturnType<typeof spawn>,
  timeoutMs = 20_000,
): Promise<SpawnedPm> {
  return new Promise((resolveId, reject) => {
    let buf = ''
    let settled = false
    let grace: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      done(new Error(`no job_id within ${timeoutMs}ms: ${buf.slice(0, 400)}`))
    }, timeoutMs)
    const done = (err: Error | null, spawned?: SpawnedPm) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (grace) clearTimeout(grace)
      child.off('error', onError)
      if (err) reject(err)
      else resolveId(spawned as SpawnedPm)
    }
    const snapshot = (): SpawnedPm | null => {
      const id = parseJobId(buf)
      if (!id) return null
      return { pmJobId: id, launcherPid: parseLauncherPid(buf) }
    }
    const consider = () => {
      const spawned = snapshot()
      if (!spawned) return
      if (spawned.launcherPid) {
        done(null, spawned)
        return
      }
      if (!grace) {
        grace = setTimeout(() => {
          const later = snapshot()
          if (later) done(null, later)
        }, 400)
      }
    }
    const onData = (chunk: Buffer | string) => {
      buf += String(chunk)
      consider()
    }
    const onError = (err: Error) => done(err)
    const onExit = (code: number | null) => {
      const spawned = snapshot()
      if (spawned) done(null, spawned)
      else if (!settled) done(new Error(`puppetmaster exited ${code}: ${buf.slice(0, 400)}`))
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', onData)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', onData)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

export function readStatus(pmJobId: string, productRoot = PRODUCT_ROOT): StatusSnap {
  const bin = resolvePm()
  const result = spawnSync(bin.command, [...bin.prefix, 'status', pmJobId, '--compact'], {
    cwd: productRoot,
    env: pmEnv(),
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `status failed for ${pmJobId}`)
  }
  return JSON.parse(result.stdout || '{}') as StatusSnap
}

export function readArtifactRefs(pmJobId: string, productRoot = PRODUCT_ROOT): unknown {
  const bin = resolvePm()
  const result = spawnSync(bin.command, [...bin.prefix, 'artifacts', pmJobId, '--refs'], {
    cwd: productRoot,
    env: pmEnv(),
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.status !== 0) return []
  try {
    return JSON.parse(result.stdout || '[]')
  } catch {
    return []
  }
}

export function killProcessGroup(pid: number | undefined): void {
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}
