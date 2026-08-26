import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { BOX_IMAGE, BOX_NAME } from '../src/runtime/computer'
import { boxMounts, boxRunArgv, boxStatus, computerLabel, ensureBox, sleepBox } from '../src/runtime/box'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-box-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('local docker box', () => {
  test('bun test never reaches the live docker daemon without a seam', () => {
    // bun test sets NODE_ENV=test, not BUN_TEST. A wrong gate once let the
    // suite recreate the user's live box bound to a temp home.
    delete process.env.AUTOMATON_DOCKER
    const status = boxStatus(tmpHome())
    expect(status.running).toBe(false)
    expect(ensureBox(tmpHome()).running).toBe(false)
  })

  test('ensure starts one named computer and sleep leaves disk', () => {
    const home = tmpHome()
    const seen: string[][] = []
    let running = false
    const docker = (args: string[]) => {
      seen.push(args)
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('PortBindings'))) {
        return { status: 0, text: '{"9221/tcp":[{"HostIp":"127.0.0.1","HostPort":"9221"}]}\n' }
      }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('Mounts'))) {
        return { status: 0, text: `/home/box/desktops=${boxMounts(home).desktops}\n` }
      }
      if (args[0] === 'inspect') return { status: 0, text: running ? 'true\n' : 'false\n' }
      if (args[0] === 'image') return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'exec') return { status: 0, text: '/usr/local/bin/automaton-screen\n' }
      if (args[0] === 'start' || args[0] === 'run') {
        running = true
        return { status: 0, text: '' }
      }
      if (args[0] === 'stop') {
        running = false
        return { status: 0, text: '' }
      }
      return { status: 1, text: 'unknown' }
    }
    const down = boxStatus(home, { docker })
    expect(down.running).toBe(false)
    expect(computerLabel(down)).toContain('idle on disk')
    const up = ensureBox(home, { docker })
    expect(up.running).toBe(true)
    expect(up.name).toBe(BOX_NAME)
    expect(seen.some((args) => args[0] === 'start' || args[0] === 'run')).toBe(true)
    const argv = boxRunArgv(home)
    expect(argv).toContain(BOX_IMAGE)
    expect(argv).toContain(BOX_NAME)
    expect(argv).toContain('--shm-size')
    expect(argv.join(' ')).toContain('/home/box/desktops')
    expect(argv.join(' ')).toContain('127.0.0.1:9221:9221')
    expect(computerLabel(up)).toContain('running')
    const slept = sleepBox(home, { docker })
    expect(slept.running).toBe(false)
    expect(computerLabel(slept)).toContain('idle on disk')
    rmSync(home, { recursive: true, force: true })
  })

  test('ensure recreates a running box that lacks automaton-screen', () => {
    const home = tmpHome()
    const seen: string[][] = []
    let running = true
    let hasScreen = false
    const docker = (args: string[]) => {
      seen.push(args)
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) {
        return { status: 0, text: hasScreen ? 'sha256:new\n' : 'sha256:old\n' }
      }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('PortBindings'))) {
        return {
          status: 0,
          text: hasScreen ? '{"9221/tcp":[{"HostIp":"127.0.0.1","HostPort":"9221"}]}\n' : '{}\n',
        }
      }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('Mounts'))) {
        return { status: 0, text: `/home/box/desktops=${boxMounts(home).desktops}\n` }
      }
      if (args[0] === 'inspect') return { status: 0, text: running ? 'true\n' : 'false\n' }
      if (args[0] === 'image') return { status: 0, text: 'sha256:new\n' }
      if (args[0] === 'exec') {
        return hasScreen
          ? { status: 0, text: '/usr/local/bin/automaton-screen\n' }
          : { status: 1, text: '' }
      }
      if (args[0] === 'rm') {
        running = false
        return { status: 0, text: '' }
      }
      if (args[0] === 'run') {
        running = true
        hasScreen = true
        return { status: 0, text: '' }
      }
      return { status: 1, text: 'unknown' }
    }
    const up = ensureBox(home, { docker })
    expect(up.running).toBe(true)
    expect(seen.some((args) => args[0] === 'rm' && args.includes('-f'))).toBe(true)
    expect(seen.some((args) => args[0] === 'run')).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  test('ensure recreates a running box whose desktops bind is another home', () => {
    const home = tmpHome()
    const seen: string[][] = []
    let running = true
    let mount = '/tmp/automaton-shell-stolen/desktops'
    const docker = (args: string[]) => {
      seen.push(args)
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('PortBindings'))) {
        return { status: 0, text: '{"9221/tcp":[{"HostIp":"127.0.0.1","HostPort":"9221"}]}\n' }
      }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('Mounts'))) {
        return { status: 0, text: `/home/box/desktops=${mount}\n` }
      }
      if (args[0] === 'inspect') return { status: 0, text: running ? 'true\n' : 'false\n' }
      if (args[0] === 'image') return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'exec') return { status: 0, text: '/usr/local/bin/automaton-screen\n' }
      if (args[0] === 'rm') {
        running = false
        return { status: 0, text: '' }
      }
      if (args[0] === 'run') {
        running = true
        mount = boxMounts(home).desktops
        return { status: 0, text: '' }
      }
      return { status: 1, text: 'unknown' }
    }
    const up = ensureBox(home, { docker })
    expect(up.running).toBe(true)
    expect(seen.some((args) => args[0] === 'rm' && args.includes('-f'))).toBe(true)
    expect(seen.some((args) => args[0] === 'run')).toBe(true)
    expect(mount).toBe(boxMounts(home).desktops)
    rmSync(home, { recursive: true, force: true })
  })

  test('ensure leaves a running box whose desktops bind is this home', () => {
    const home = tmpHome()
    const seen: string[][] = []
    const docker = (args: string[]) => {
      seen.push(args)
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('PortBindings'))) {
        return { status: 0, text: '{"9221/tcp":[{"HostIp":"127.0.0.1","HostPort":"9221"}]}\n' }
      }
      if (args[0] === 'inspect' && args.some((arg) => arg.includes('Mounts'))) {
        return { status: 0, text: `/home/box/desktops=${boxMounts(home).desktops}\n` }
      }
      if (args[0] === 'inspect') return { status: 0, text: 'true\n' }
      if (args[0] === 'image') return { status: 0, text: 'sha256:abc\n' }
      if (args[0] === 'exec') return { status: 0, text: '/usr/local/bin/automaton-screen\n' }
      return { status: 1, text: 'unknown' }
    }
    expect(ensureBox(home, { docker }).running).toBe(true)
    expect(seen.some((args) => args[0] === 'rm' || args[0] === 'run')).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  test('missing docker is not a second hypervisor', () => {
    const home = tmpHome()
    const status = boxStatus(home, {
      docker: () => ({ status: 127, text: 'docker: command not found' }),
    })
    expect(status.docker).toBe('missing')
    expect(status.running).toBe(false)
    expect(computerLabel(status)).toContain('Docker missing')
    rmSync(home, { recursive: true, force: true })
  })
})
