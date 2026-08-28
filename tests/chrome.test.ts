import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  browse,
  captureAgentDesk,
  captureScreen,
  chromeAvailable,
  chromeBinary,
  chromeLaunch,
  chromeMode,
  clickAgentDesk,
  devtoolsPath,
  ensureBrowser,
  goToUrl,
  isAutomatonHostChromeCmd,
  readHandle,
  sweepHostChrome,
  teardownBrowserDesktop,
  boxProfileLockRmArgv,
  type ChromeSeams,
} from '../src/runtime/chrome'
import { captchaOrigin, continueFromSorry, sorryPage } from '../src/runtime/computer-tools'
import { BOX_NAME, boxChromeDebugPort } from '../src/runtime/computer'
import {
  desktopDir,
  desktopPreview,
  ensureDesktop,
  readDeskSurface,
  teardownDesktop,
  writeDeskSurface,
} from '../src/runtime/desktop'

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

  test('bun test does not resolve the Mac Chrome binary', () => {
    expect(chromeBinary()).toBeNull()
    expect(chromeMode()).toBe('none')
  })

  test('chromeMode prefers host when a Mac binary exists, even if the box is up', () => {
    const running = { docker: () => ({ status: 0, text: 'true\n' }) }
    expect(
      chromeMode({
        binary: '/fake/Google Chrome',
        box: running,
      }),
    ).toBe('host')
    expect(chromeMode({ binary: '/fake/Google Chrome' })).toBe('host')
  })

  test('chromeMode uses box when no host binary and the box is up', () => {
    expect(
      chromeMode({
        binary: null,
        box: { docker: () => ({ status: 0, text: 'true\n' }) },
      }),
    ).toBe('box')
  })

  test('forceBox keeps worker clicks on box Chrome', () => {
    expect(
      chromeMode({
        binary: '/fake/Google Chrome',
        forceBox: true,
        box: { docker: () => ({ status: 0, text: 'true\n' }) },
      }),
    ).toBe('box')
  })

  test('ensureBrowser does not spawn Mac Chrome from a test home', async () => {
    const home = tmpHome()
    expect(await ensureBrowser('staff', home)).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })

  test('ensureBrowser host preference does not launch when tests gate the binary', async () => {
    const home = tmpHome()
    const spawned: string[] = []
    const handle = await ensureBrowser('staff', home, {
      binary: '/fake/Google Chrome',
      box: { docker: () => ({ status: 0, text: 'true\n' }) },
      spawn: (bin) => {
        spawned.push(bin)
        return { pid: 99 }
      },
      pickPort: () => 9333,
      waitReady: async () => {},
      alive: () => false,
      kill: () => {},
    })
    expect(handle?.via).toBe('host')
    expect(spawned).toEqual(['/fake/Google Chrome'])
    rmSync(home, { recursive: true, force: true })
  })

  test('sweep kills Automaton host Chrome argv only', () => {
    const killed: number[] = []
    const n = sweepHostChrome({
      ps: () =>
        [
          '  11 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '  22 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/automaton-shell-1/desktops/staff/browser --headless=new',
          '  33 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/me/Library/Application Support/Google/Chrome',
          '  44 Google Chrome Helper --user-data-dir=/Users/me/.automaton/desktops/kernel/browser',
        ].join('\n'),
      kill: (pid) => {
        killed.push(pid)
      },
    })
    expect(isAutomatonHostChromeCmd('--user-data-dir=/tmp/automaton-shell-1/desktops/staff/browser')).toBe(true)
    expect(
      isAutomatonHostChromeCmd(
        '--user-data-dir=/Users/me/Library/Application Support/Google/Chrome',
      ),
    ).toBe(false)
    expect(killed).toEqual([22, 44])
    expect(n).toBe(2)
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

describe('captcha origin', () => {
  test('covers google search and sorry URLs, not github.com', () => {
    expect(captchaOrigin('https://www.google.com/search?q=nvidia+stock+futures')).toBe(true)
    expect(captchaOrigin('https://google.com/search?q=nvidia')).toBe(true)
    expect(captchaOrigin('https://www.google.com/sorry/index?continue=https://www.google.com/search?q=n')).toBe(true)
    expect(captchaOrigin('https://www.google.com/recaptcha/api.js')).toBe(true)
    expect(captchaOrigin('https://github.com/professorpalmer/Automaton')).toBe(false)
    expect(captchaOrigin('https://example.com')).toBe(false)
  })

  test('sorryPage is unusual traffic / recaptcha /sorry', () => {
    expect(sorryPage('https://www.google.com/sorry/index', 'Our systems have detected unusual traffic')).toBe(true)
    expect(sorryPage('https://www.google.com/search?q=n', "I'm not a robot")).toBe(true)
    expect(sorryPage('https://example.com', 'Example Domain')).toBe(false)
    expect(
      continueFromSorry(
        'https://www.google.com/sorry/index?continue=https://www.google.com/search?q=nvidia+stock+futures',
        'https://www.google.com/',
      ),
    ).toBe('https://www.google.com/search?q=nvidia stock futures')
  })
})

describe('host desk for captcha', () => {
  const running = { docker: () => ({ status: 0, text: 'true\n' }) }

  test('forceBox + google URL is host when a Mac binary exists', () => {
    expect(
      chromeMode({
        binary: '/fake/Google Chrome',
        forceBox: true,
        url: 'https://www.google.com/search?q=nvidia+stock+futures',
        box: running,
      }),
    ).toBe('host')
  })

  test('forceBox still boxes non-google URLs', () => {
    expect(
      chromeMode({
        binary: '/fake/Google Chrome',
        forceBox: true,
        url: 'https://example.com',
        box: running,
      }),
    ).toBe('box')
    expect(
      chromeMode({
        binary: '/fake/Google Chrome',
        forceBox: true,
        box: running,
      }),
    ).toBe('box')
  })

  test('forceBox google browse opens host Chrome and records host surface', async () => {
    const home = tmpHome()
    const spawned: string[] = []
    const seen: string[] = []
    const dest = await browse('staff', 'https://www.google.com/search?q=nvidia+stock+futures', home, {
      binary: '/fake/Google Chrome',
      forceBox: true,
      box: running,
      pickPort: () => 9333,
      spawn: (bin) => {
        spawned.push(bin)
        return { pid: 88 }
      },
      waitReady: async () => {},
      navigate: async (_port, url) => {
        seen.push(url)
      },
      capturePng: async () => TINY_PNG,
      alive: () => true,
      kill: () => {},
    })
    expect(spawned).toEqual(['/fake/Google Chrome'])
    expect(seen).toEqual(['https://www.google.com/search?q=nvidia+stock+futures'])
    expect(readDeskSurface('staff', home)).toBe('host')
    expect(dest && existsSync(dest)).toBe(true)
    teardownBrowserDesktop('staff', home, { kill: () => {} })
    rmSync(home, { recursive: true, force: true })
  })

  test('desk routes capture and clicks to host when surface is host', async () => {
    const home = tmpHome()
    const clicks: Array<{ x: number; y: number }> = []
    const seams: ChromeSeams = {
      binary: '/fake/Google Chrome',
      forceBox: true,
      pickPort: () => 9555,
      spawn: () => ({ pid: 77 }),
      waitReady: async () => {},
      capturePng: async () => TINY_PNG,
      clickPage: async (_port, point) => {
        clicks.push(point)
        return true
      },
      alive: () => true,
      kill: () => {},
    }
    await ensureBrowser('staff', home, { ...seams, forceBox: false })
    writeDeskSurface('staff', 'host', home)
    const dest = await captureAgentDesk('staff', home, seams)
    expect(dest).toBeTruthy()
    expect(dest).toContain(`paint-${process.pid}-`)
    expect(existsSync(dest!)).toBe(true)
    expect(clickAgentDesk('staff', { x: 40, y: 80 }, 0, home, seams)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(clicks).toEqual([{ x: 40, y: 80 }])
    writeDeskSurface('staff', 'box', home)
    const boxShot = await captureAgentDesk('staff', home, {
      ...seams,
      box: { docker: () => ({ status: 0, text: 'false\n' }) },
    })
    expect(boxShot).toBeNull()
    teardownBrowserDesktop('staff', home, seams)
    rmSync(home, { recursive: true, force: true })
  })

  test('box sorry page flips browse onto host Chrome', async () => {
    const home = tmpHome()
    const spawned: string[] = []
    const seen: string[] = []
    const dest = await browse('staff', 'https://example.com', home, {
      binary: '/fake/Google Chrome',
      forceBox: true,
      box: running,
      pickPort: () => 9666,
      spawn: (bin) => {
        spawned.push(bin)
        return { pid: spawned.length + 10 }
      },
      waitReady: async () => {},
      navigate: async (_port, url) => {
        seen.push(url)
      },
      pageInfo: async () => ({
        url: 'https://www.google.com/sorry/index?continue=https://www.google.com/search?q=nvidia+stock+futures',
        title: 'unusual traffic',
      }),
      capturePng: async () => TINY_PNG,
      alive: () => true,
      kill: () => {},
    })
    expect(seen).toContain('https://example.com')
    expect(seen).toContain('https://www.google.com/search?q=nvidia stock futures')
    expect(readDeskSurface('staff', home)).toBe('host')
    expect(dest && existsSync(dest)).toBe(true)
    teardownBrowserDesktop('staff', home, { kill: () => {} })
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
