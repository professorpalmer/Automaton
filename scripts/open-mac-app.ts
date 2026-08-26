import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const app = join(root, 'macos', 'Automaton.app')
if (process.platform === 'darwin' && existsSync(app)) {
  spawn('open', ['-n', app], { stdio: 'inherit' })
} else {
  spawn('bun', [join(root, 'src', 'main.tsx')], { stdio: 'inherit', cwd: root })
}
