import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dir, '..')
export const MAC_APP = join(root, 'macos', 'Automaton.app')
const MACOS = join(MAC_APP, 'Contents', 'MacOS')

function bunOnPath(): string | null {
  const result = spawnSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' })
  const path = (result.stdout || '').trim()
  return path || null
}

function needsWrite(src: string, dest: string): boolean {
  if (!existsSync(dest)) return true
  return statSync(src).mtimeMs > statSync(dest).mtimeMs
}

function isMachO(path: string): boolean {
  if (!existsSync(path)) return false
  const magic = readFileSync(path).subarray(0, 4)
  return (
    magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
    magic.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
    magic.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
  )
}

/** Mach-O stub plus a bun copy inside the .app so Dock uses AppIcon, not a CLI. */
export function prepareMacApp(repo = root): { app: string; bun: string; stub: string } {
  const macos = join(repo, 'macos', 'Automaton.app', 'Contents', 'MacOS')
  mkdirSync(macos, { recursive: true })
  const stubSrc = join(repo, 'macos', 'stub.c')
  const stubBin = join(macos, 'Automaton')
  const bundleBun = join(macos, 'runtime')
  const bun = bunOnPath()
  if (!bun) throw new Error('Automaton needs bun on PATH.')
  if (needsWrite(bun, bundleBun)) copyFileSync(bun, bundleBun)
  chmodSync(bundleBun, 0o755)
  if (needsWrite(stubSrc, stubBin) || !isMachO(stubBin)) {
    const clang = spawnSync(
      'clang',
      ['-Os', '-o', stubBin, stubSrc],
      { encoding: 'utf8' },
    )
    if (clang.status !== 0) {
      throw new Error(clang.stderr || clang.stdout || 'clang failed')
    }
  }
  chmodSync(stubBin, 0o755)
  return { app: join(repo, 'macos', 'Automaton.app'), bun: bundleBun, stub: stubBin }
}

export function openMacApp(app = MAC_APP): void {
  spawn('open', ['-n', app], { stdio: 'inherit' })
}

if (import.meta.main) {
  if (process.platform === 'darwin' && existsSync(dirname(MACOS))) {
    const { app } = prepareMacApp()
    spawnSync('/usr/bin/touch', [app])
    spawnSync(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', app],
    )
    openMacApp(app)
  } else {
    spawn('bun', [join(root, 'src', 'main.tsx')], { stdio: 'inherit', cwd: root })
  }
}
