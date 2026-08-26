import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeSpeak } from '../src/domain'
import {
  PRODUCT_ROOT,
  analysisInstruction,
  assertSandboxCwd,
  buildAnalyzeArgv,
  buildImplementArgv,
  jobOutcome,
  ownerLabel,
  parseJobId,
  parseLauncherPid,
  seedSandboxFromProduct,
  spokenFromArtifactRefs,
  substantiveSpokenFromRefs,
  writeAnalyzeConfig,
  writeImplementConfig,
} from '../src/runtime/pm.ts'

describe('puppetmaster spawn contract', () => {
  test('parses job_id from CLI stdout', () => {
    expect(parseJobId('job_id: job_ab12cd34\nmode: analyze')).toBe('job_ab12cd34')
    expect(parseJobId('job_ab12cd34\n')).toBe('job_ab12cd34')
    expect(parseJobId('noise')).toBeNull()
    expect(parseLauncherPid('# detached launcher_pid=97722  next: feed')).toBe(97722)
  })

  test('spoken lines never keep job ids', () => {
    expect(sanitizeSpeak('Done. job_ab12cd34 finished')).toBe('Done. finished')
    expect(sanitizeSpeak('job_id: job_ab12cd34')).toBe('Done.')
  })

  test('analyze argv is run --config matching the MCP twin', () => {
    const instruction = analysisInstruction('ping')
    const files = writeAnalyzeConfig({
      localId: 'test_config',
      instruction,
      workerCwd: PRODUCT_ROOT,
      timeoutSeconds: 180,
    })
    const cfg = JSON.parse(readFileSync(files.configPath, 'utf8'))
    expect(cfg.workers[0].adapter).toBe('cursor')
    expect(cfg.workers[0].payload.model).toBe('grok-4.6')
    expect(cfg.workers[0].payload.read_only).toBe(true)
    expect(cfg.workers[0].payload.cwd).toBe(PRODUCT_ROOT)
    const argv = buildAnalyzeArgv({
      ...files,
      label: 'kernel analyze request',
      launchKey: 'test_config',
    })
    expect(argv).toContain('--emit-job-id-early')
    expect(argv).toContain('run')
    expect(argv).toContain('--config')
    expect(argv).toContain(files.configPath)
    expect(argv).toContain('--goal-file')
    expect(argv).toContain(files.goalPath)
    expect(argv).toContain('--launch-key')
    expect(argv[argv.indexOf('--launch-key') + 1]).toBe('test_config')
    expect(argv).not.toContain('--implement')
    expect(argv).not.toContain('swarm')
  })

  test('implement argv refuses the Automaton checkout', () => {
    expect(() => assertSandboxCwd(PRODUCT_ROOT)).toThrow(/refusing/)
    expect(() =>
      buildImplementArgv({
        prompt: 'ping',
        workerCwd: PRODUCT_ROOT,
        label: 'kernel implement request',
      }),
    ).toThrow(/refusing/)
    const argv = buildImplementArgv({
      prompt: 'ping',
      workerCwd: join('/tmp', 'automaton-sandbox-probe'),
      label: 'kernel implement request',
    })
    expect(argv).toContain('--implement')
    expect(argv).not.toContain('--no-edit')
  })

  test('implement run --config cwd is never the product checkout', () => {
    expect(() =>
      writeImplementConfig({
        localId: 'test_impl_refuse',
        instruction: 'ping',
        workerCwd: PRODUCT_ROOT,
      }),
    ).toThrow(/refusing/)
    const files = writeImplementConfig({
      localId: 'test_impl_ok',
      instruction: 'ping',
      workerCwd: join('/tmp', 'automaton-sandbox-probe'),
    })
    const cfg = JSON.parse(readFileSync(files.configPath, 'utf8'))
    expect(cfg.workers[0].payload.mode).toBe('implement')
    expect(cfg.workers[0].payload.implement).toBe(true)
    expect(cfg.workers[0].payload.allow_dirty).toBe(true)
    expect(cfg.workers[0].payload.allow_non_worktree).toBe(false)
    expect(cfg.workers[0].payload.read_only).toBeUndefined()
    expect(cfg.workers[0].payload.cwd).not.toBe(PRODUCT_ROOT)
    expect(cfg.workers[0].payload.cwd.startsWith(PRODUCT_ROOT)).toBe(false)
    const argv = buildAnalyzeArgv({
      ...files,
      label: 'kernel implement request',
      launchKey: 'test_impl_ok',
    })
    expect(argv).toContain('--config')
    expect(argv).toContain('--launch-key')
    expect(argv[argv.indexOf('--launch-key') + 1]).toBe('test_impl_ok')
    expect(argv).not.toContain('--implement')
    expect(ownerLabel({ id: 'j', ownerAgentId: 'kernel', goal: 'g', status: 'running', kind: 'implement' })).toBe(
      'kernel implement request',
    )
    expect(ownerLabel({ id: 'j', ownerAgentId: 'research', goal: 'g', status: 'running', kind: 'analyze' })).toBe(
      'research look up',
    )
  })

  test('sandbox seed is a git worktree outside the checkout', () => {
    const product = join(homedir(), '.automaton', 'fixtures', `tiny-product-${Date.now()}`)
    mkdirSync(product, { recursive: true })
    writeFileSync(join(product, 'hello.txt'), 'hi')
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Automaton',
      GIT_AUTHOR_EMAIL: 'automaton@local',
      GIT_COMMITTER_NAME: 'Automaton',
      GIT_COMMITTER_EMAIL: 'automaton@local',
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    }
    const git = (args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=Automaton', '-c', 'user.email=automaton@local', ...args], {
        cwd: product,
        env,
        encoding: 'utf8',
      })
      if (result.status !== 0) throw new Error(result.stderr || result.stdout)
    }
    git(['init'])
    git(['add', '-A'])
    git(['commit', '-m', 'fixture'])
    const sandbox = seedSandboxFromProduct(`test_seed_${Date.now()}`, product)
    expect(sandbox).not.toBe(product)
    expect(existsSync(join(sandbox, 'hello.txt'))).toBe(true)
    expect(existsSync(join(sandbox, '.git'))).toBe(true)
    expect(() => assertSandboxCwd(sandbox, product)).not.toThrow()
    spawnSync('git', ['worktree', 'remove', '--force', sandbox], { cwd: product, env, encoding: 'utf8' })
  })

  test('status maps to mouth outcomes', () => {
    expect(jobOutcome({ job: { status: 'running' } })).toBe('running')
    expect(jobOutcome({ job: { status: 'complete' } })).toBe('complete')
    expect(jobOutcome({ job: { status: 'failed' } })).toBe('failed')
    expect(jobOutcome({ job: { status: 'cancelled' } })).toBe('failed')
    expect(jobOutcome({ job: { status: 'stalled' } })).toBe('failed')
    expect(jobOutcome({ job: { status: 'complete' }, delivery: { successful: false } })).toBe(
      'failed',
    )
    expect(jobOutcome({})).toBe('running')
    expect(jobOutcome({ job: { status: 'unknown' } })).toBe('running')
  })

  test('FINDING claim becomes the spoken line', () => {
    expect(
      spokenFromArtifactRefs([
        { type: 'finding', claim: 'The sandbox README is the only file.' },
      ]),
    ).toBe('The sandbox README is the only file.')
    expect(spokenFromArtifactRefs([{ type: 'verification', result: 'failed' }])).toBe(
      "Didn't land.",
    )
    expect(spokenFromArtifactRefs([])).toBe('Done.')
    expect(substantiveSpokenFromRefs([])).toBeNull()
    expect(substantiveSpokenFromRefs([{ type: 'finding', claim: 'Done.' }])).toBeNull()
    expect(
      substantiveSpokenFromRefs([{ type: 'finding', claim: 'The sandbox README is the only file.' }]),
    ).toBe('The sandbox README is the only file.')
  })
})
