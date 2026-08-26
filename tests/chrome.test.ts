import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  browse,
  captureScreen,
  chromeAvailable,
  chromeBinary,
  chromeLaunch,
  chromeMode,
  devtoolsPath,
  ensureBrowser,
  goToUrl,
  readHandle,
  teardownBrowserDesktop,
  boxProfileLockRmArgv,
  type ChromeSeams,
} from '../src/runtime/chrome'
import { BOX_NAME, boxChromeDebugPort } from '../src/runtime/computer'
import { desktopDir, desktopPreview, ensureDesktop, teardownDesktop } from '../src/runtime/desktop'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-chrome-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('browser helper', () => {
  test('missing binary is false and does not throw', () => {
    expect(chromeAvailable({ binary: null })).toBe(false)
    expect(chromeBinary({ binary: null })).toBeNull()
    expect(chromeMode({ binary: null })).toBe('none')
  })

  test('box launch is docker exec on a shared display, not a second VM', () => {
    const home = tmpHome()
    const launch = chromeLaunch({ agentId: 'kernel', port: 9333, mode: 'box', home })
    expect(launch.bin).toBe('docker')
    expect(launch.display).toBe(2)
    expect(launch.argv).toContain(BOX_NAME)
    expect(launch.argv.join(' ')).toContain('DISPLAY=:2')
    expect(launch.argv.join(' ')).toContain('/home/box/desktops/kernel/box-chrome')
    expect(launch.argv.join(' ')).toContain('--remote-debugging-port=9333')
    expect(launch.argv.join(' ')).toContain('--remote-debugging-address=0.0.0.0')
    expect(launch.argv.join(' ')).toContain('--no-sandbox')
    expect(launch.argv.join(' ')).toContain('--disable-dev-shm-usage')
    expect(launch.argv.join(' ')).toContain('--disable-blink-features=AutomationControlled')
    expect(launch.argv.join(' ')).not.toContain('--test-type')
    expect(launch.argv.join(' ')).not.toContain('--disable-infobars')
    expect(launch.argv.join(' ')).not.toContain('Xvfb')
    expect(launch.argv.join(' ')).not.toContain('novnc')
    expect(launch.argv.join(' ')).not.toContain('headless')
    expect(boxChromeDebugPort(1)).toBe(9221)
    expect(boxChromeDebugPort(2)).toBe(9222)
    expect(boxProfileLockRmArgv('staff').join(' ')).toContain('rm -f')
    expect(boxProfileLockRmArgv('staff').join(' ')).toContain('/home/box/desktops/staff/box-chrome/SingletonLock')
    rmSync(home, { recursive: true, force: true })
  })

  test('fake child records pid/port and capture writes a png', async () => {
    const home = tmpHome()
    const killed: number[] = []
    const seams: ChromeSeams = {
      binary: '/fake/Google Chrome',
      pickPort: () => 9333,
      spawn: (bin, argv) => {
        expect(bin).toBe('/fake/Google Chrome')
        expect(argv.some((item) => item.startsWith('--user-data-dir='))).toBe(true)
        expect(argv).toContain('--remote-debugging-port=9333')
        expect(argv).toContain('--headless=new')
        return { pid: 4242 }
      },
      waitReady: async () => {},
      capturePng: async (port) => {
        expect(port).toBe(9333)
        return TINY_PNG
      },
      alive: (pid) => pid === 4242,
      kill: (pid) => {
        killed.push(pid)
      },
    }
    const handle = await ensureBrowser('staff', home, seams)
    expect(handle).toEqual({ pid: 4242, port: 9333, display: 1, via: 'host' })
    expect(readHandle('staff', home)).toEqual({ pid: 4242, port: 9333, display: 1, via: 'host' })
    const dest = await captureScreen('staff', home, seams)
    expect(dest).toBe(join(desktopDir('staff', home), 'screen.png'))
    expect(existsSync(dest!)).toBe(true)
    expect(readFileSync(dest!).equals(TINY_PNG)).toBe(true)
    expect(desktopPreview('staff', home).screen).toBe(dest)
    teardownBrowserDesktop('staff', home, seams)
    expect(killed).toEqual([4242])
    expect(existsSync(desktopDir('staff', home))).toBe(false)
    expect(existsSync(devtoolsPath('staff', home))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  test('browse navigates then captures', async () => {
    const home = tmpHome()
    const seen: string[] = []
    const seams: ChromeSeams = {
      binary: '/fake/chrome',
      pickPort: () => 9444,
      spawn: () => ({ pid: 7 }),
      waitReady: async () => {},
      navigate: async (_port, url) => {
        seen.push(url)
      },
      capturePng: async () => TINY_PNG,
      alive: () => true,
      kill: () => {},
    }
    const dest = await browse('kernel', 'https://example.com', home, seams)
    expect(seen).toEqual(['https://example.com'])
    expect(dest && existsSync(dest)).toBe(true)
    teardownBrowserDesktop('kernel', home, seams)
    rmSync(home, { recursive: true, force: true })
  })

  test('capture without a binary returns null', async () => {
    const home = tmpHome()
    expect(await captureScreen('staff', home, { binary: null })).toBeNull()
    expect(desktopPreview('staff', home).screen).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })

  test('box navigate uses CDP then falls back to typing the URL', async () => {
    const home = tmpHome()
    const seen: string[] = []
    expect(
      await goToUrl('box', 9221, 'staff', 'https://example.com', home, {
        navigate: async (port, url) => {
          expect(port).toBe(9221)
          seen.push(url)
        },
      }),
    ).toBe(true)
    expect(seen).toEqual(['https://example.com'])
    expect(
      await goToUrl('host', 9333, 'staff', 'https://example.com', home, {
        navigate: async () => {
          throw new Error('cdp down')
        },
      }),
    ).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})

describe('mouth desktop', () => {
  test('desktopPreview is unchanged when no screen', () => {
    const home = tmpHome()
    ensureDesktop('research', home)
    const preview = desktopPreview('research', home)
    expect(preview.screen).toBeNull()
    expect(preview.dir).toBe(desktopDir('research', home))
    teardownDesktop('research', home)
    rmSync(home, { recursive: true, force: true })
  })
})
