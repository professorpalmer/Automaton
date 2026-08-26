import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { automatonHome } from '../src/runtime/keys'
import { boxExec, ensureBox } from '../src/runtime/box'
import { ensureBrowser } from '../src/runtime/chrome'
import { captureDesk, clickDesk, openDeskUrl } from '../src/runtime/desk'
import { boxChromeAlive, boxChromeWindowReady, ensureScreen } from '../src/runtime/screen'

const dest = join(import.meta.dir, '..', 'artifacts', 'box-screen.png')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const box = ensureBox()
if (!box.running) {
  console.error(`box not running: ${box.docker}`)
  process.exit(1)
}
const screenBin = boxExec(['which', 'automaton-screen'])
if (screenBin.status !== 0) {
  console.error('automaton-screen missing on the box; rebuild automaton-computer:local')
  process.exit(1)
}
if (!ensureScreen('staff')) {
  console.error('ensureScreen staff failed')
  process.exit(1)
}
const browser = await ensureBrowser('staff')
if (!browser) {
  console.error('ensureBrowser staff failed')
  process.exit(1)
}
const deadline = Date.now() + 20_000
while (Date.now() < deadline && !boxChromeWindowReady('staff')) {
  await sleep(200)
}
if (!boxChromeAlive('staff')) {
  console.error('chromium process did not stay up')
  process.exit(1)
}
if (!boxChromeWindowReady('staff')) {
  console.error('chromium window did not map')
  process.exit(1)
}
await sleep(800)
clickDesk('staff', { x: 640, y: 400 })
await sleep(400)
if (!openDeskUrl('staff', 'https://example.com')) {
  console.error('openDeskUrl staff failed')
  process.exit(1)
}
await sleep(1200)
const path = captureDesk('staff')
if (!path || !existsSync(path)) {
  console.error('captureDesk staff missed')
  process.exit(1)
}
mkdirSync(join(import.meta.dir, '..', 'artifacts'), { recursive: true })
copyFileSync(path, dest)
const size = statSync(dest).size
if (size < 12000) {
  console.error(`screen too small (${size} bytes) — expected a Chromium desktop, not an empty root`)
  process.exit(1)
}
console.log(`box screen ${size} bytes home=${automatonHome()} dest=${dest}`)
