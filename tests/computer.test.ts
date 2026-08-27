import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  BOX_NAME,
  assignDisplay,
  boxProfileDir,
  displayForMouth,
  mouthScreen,
  sameComputer,
} from '../src/runtime/computer'
import {
  LEASE_TTL_MS,
  IDLE_SUSPEND_WINDOW_MS,
  createDisplayLeases,
} from '../src/runtime/lease'
import {
  humanDrivingSpoken,
  refuseWhileHumanDriving,
  resetDrivingForTests,
  setHumanDriving,
  whoIsDriving,
} from '../src/runtime/driving'
import {
  HOST_APPROVAL_PROMPT,
  boxShellLooksLikeGui,
  computerWorkerAllowed,
  executeComputerBatch,
  executeComputerTool,
  idleComputer,
  looksLikeComputerUse,
  looksLikePasswordSite,
  preferredToolForAsk,
  prefixHasTimestamp,
  routeComputerSurface,
  stableComputerPrefix,
  toolsForComputerRole,
  trimScreenshots,
} from '../src/runtime/computer-tools'
import { COMPUTER_ROUNDS, runComputerWorker } from '../src/runtime/computer-worker'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-computer-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('one computer', () => {
  test('every mouth shares the box; screens are displays', () => {
    const home = tmpHome()
    const staff = mouthScreen('staff', home)
    const kernel = mouthScreen('kernel', home)
    const extra = mouthScreen('agent_19', home)
    expect(sameComputer(staff.agentId, kernel.agentId)).toBe(true)
    expect(staff.display).toBe(1)
    expect(kernel.display).toBe(2)
    expect(mouthScreen('research', home).display).toBe(3)
    expect(extra.display).toBe(4)
    expect(assignDisplay('agent_19', home)).toBe(4)
    expect(boxProfileDir('kernel')).toBe('/home/box/desktops/kernel/box-chrome')
    expect(displayForMouth('staff')).toBe(1)
    expect(displayForMouth('kernel')).toBe(2)
    expect(BOX_NAME).toBe('automaton-computer')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('display lease', () => {
  test('one writer at a time; the other is busy', () => {
    let now = 1_000
    const leases = createDisplayLeases(() => now)
    expect(leases.acquire(1, 'kernel').ok).toBe(true)
    const busy = leases.acquire(1, 'research')
    expect(busy.ok).toBe(false)
    if (!busy.ok) expect(busy.reason).toBe('busy')
    expect(leases.holder(1)).toBe('kernel')
    expect(leases.release(1, 'research')).toBe(false)
    expect(leases.release(1, 'kernel')).toBe(true)
    expect(leases.acquire(1, 'research').ok).toBe(true)
  })

  test('events renew the lease; a dead turn expires', () => {
    let now = 5_000
    const leases = createDisplayLeases(() => now)
    expect(leases.acquire(2, 'kernel').ok).toBe(true)
    now += LEASE_TTL_MS - 1
    expect(leases.renew(2, 'kernel')).toBe(true)
    now += LEASE_TTL_MS - 1
    expect(leases.holder(2)).toBe('kernel')
    now += 2
    expect(leases.holder(2)).toBeNull()
    expect(leases.acquire(2, 'research').ok).toBe(true)
  })

  test('idle suspend defers if busy and retries a full window', () => {
    let now = 10_000
    const leases = createDisplayLeases(() => now)
    expect(leases.idleSuspend().ok).toBe(true)
    leases.acquire(1, 'kernel')
    const deferred = idleComputer({ leases, sleep: () => true })
    expect(deferred.slept).toBe(false)
    expect(deferred.retryAt).toBe(now + IDLE_SUSPEND_WINDOW_MS)
    leases.release(1, 'kernel')
    expect(idleComputer({ leases, sleep: () => true }).slept).toBe(true)
  })

  test('idle suspend fail retries a full window', () => {
    let now = 20_000
    const leases = createDisplayLeases(() => now)
    const failed = idleComputer({ leases, sleep: () => false })
    expect(failed.slept).toBe(false)
    expect(failed.retryAt).toBeGreaterThanOrEqual(now + IDLE_SUSPEND_WINDOW_MS)
  })

  test('fail open if the clock hiccups', () => {
    const leases = createDisplayLeases(() => {
      throw new Error('clock')
    })
    expect(leases.acquire(1, 'kernel').ok).toBe(true)
    expect(leases.idleSuspend().ok).toBe(true)
  })
})

describe('who is driving', () => {
  test('pixel and CDP tools refuse while the person has the wheel', async () => {
    resetDrivingForTests()
    setHumanDriving(1, true)
    expect(whoIsDriving(1)).toBe('human')
    expect(refuseWhileHumanDriving('box_computer', 1).refuse).toBe(true)
    expect(refuseWhileHumanDriving('box_browser', 1).refuse).toBe(true)
    expect(refuseWhileHumanDriving('box_shell', 1).refuse).toBe(false)
    const click = await executeComputerTool(
      { name: 'box_computer', args: { x: 10, y: 10 } },
      { agentId: 'kernel', display: 1, holderId: 'w1', role: 'worker', kit: 'code' },
      { click: () => true },
    )
    expect(click.ok).toBe(false)
    expect(click.refused).toBe(true)
    expect(click.spoken).toBe(humanDrivingSpoken())
    setHumanDriving(1, false)
    const after = await executeComputerTool(
      { name: 'box_computer', args: { x: 10, y: 10 } },
      { agentId: 'kernel', display: 1, holderId: 'w1', role: 'worker', kit: 'code' },
      { click: () => true, leases: createDisplayLeases() },
    )
    expect(after.ok).toBe(true)
  })

  test('do not enqueue behind the human; fail open if driving is unknown', async () => {
    resetDrivingForTests()
    expect(whoIsDriving(3)).toBe('unknown')
    expect(refuseWhileHumanDriving('box_browser', 3).refuse).toBe(false)
    setHumanDriving(1, true)
    const batch = await executeComputerBatch(
      [
        { name: 'box_computer', args: { x: 1, y: 1 } },
        { name: 'box_computer', args: { x: 2, y: 2 } },
      ],
      { agentId: 'kernel', display: 1, holderId: 'w1', role: 'worker', kit: 'code' },
      { click: () => true },
    )
    expect(batch.halted).toBe(true)
    expect(batch.results).toHaveLength(1)
    expect(batch.results[0]?.refused).toBe(true)
  })
})

describe('computer tool catalog', () => {
  test('install on your computer is box_shell, not host_shell', () => {
    const text = 'install cowsay on your computer'
    expect(routeComputerSurface(text)).toBe('box')
    expect(preferredToolForAsk(text)).toBe('box_shell')
  })

  test('Mac home path is host_read with a card, never docker exec', async () => {
    const text = "what's in ~/Projects on my Mac"
    expect(routeComputerSurface(text)).toBe('host')
    expect(preferredToolForAsk(text)).toBe('host_read')
    let boxed = false
    const result = await executeComputerTool(
      { name: 'host_read', args: { path: '/Users/carypalmer/Projects' } },
      { agentId: 'staff', display: 1, holderId: 'w1', role: 'coordinator', kit: 'coordinator' },
      {
        boxExec: () => {
          boxed = true
          return { status: 0, text: 'secret' }
        },
      },
    )
    expect(boxed).toBe(false)
    expect(result.needsApproval).toBe(true)
    expect(result.spoken).toBe(HOST_APPROVAL_PROMPT)
    const denied = await executeComputerTool(
      { name: 'host_read', args: { path: '/Users/carypalmer/Projects' } },
      { agentId: 'staff', display: 1, holderId: 'w1', role: 'coordinator', kit: 'coordinator' },
      {
        hostAllowed: false,
        boxExec: () => {
          boxed = true
          return { status: 0, text: 'fallback' }
        },
      },
    )
    expect(boxed).toBe(false)
    expect(denied.ok).toBe(false)
    expect(denied.needsApproval).toBe(true)
    const approved = await executeComputerTool(
      { name: 'host_read', args: { path: '/Users/carypalmer/Projects' } },
      { agentId: 'staff', display: 1, holderId: 'w1', role: 'coordinator', kit: 'coordinator' },
      {
        hostAllowed: true,
        boxExec: () => {
          boxed = true
          return { status: 0, text: 'secret' }
        },
      },
    )
    expect(boxed).toBe(false)
    expect(approved.ok).toBe(true)
    expect(approved.needsApproval).toBeUndefined()
    expect(approved.spoken).toBe('Running on your Mac.')
  })

  test('open example.com is box_browser; password sites are operator_help', () => {
    expect(preferredToolForAsk('open example.com')).toBe('box_browser')
    expect(looksLikeComputerUse('open example.com')).toBe(true)
    expect(looksLikePasswordSite('open github.com/login so I can sign in')).toBe(true)
    expect(preferredToolForAsk('Can you navigate to the github on your pc so I can login?')).toBe(
      'operator_help',
    )
  })

  test('box_shell cannot be the path that clicks', async () => {
    expect(boxShellLooksLikeGui('xdotool mousemove 10 10 click 1')).toBe(true)
    const result = await executeComputerTool(
      { name: 'box_shell', args: { command: 'xdotool click 1' } },
      { agentId: 'kernel', display: 2, holderId: 'w1', role: 'worker', kit: 'code' },
      { boxExec: () => ({ status: 0, text: 'clicked' }) },
    )
    expect(result.ok).toBe(false)
    expect(result.refused).toBe(true)
  })

  test('Staff coordinator does not get pixel tools; workers do; blank and ping do not', () => {
    expect(toolsForComputerRole('coordinator', 'coordinator')).not.toContain('box_computer')
    expect(toolsForComputerRole('coordinator', 'coordinator')).not.toContain('box_browser')
    expect(toolsForComputerRole('worker', 'code')).toContain('box_computer')
    expect(toolsForComputerRole('worker', 'lookup')).toContain('box_browser')
    expect(toolsForComputerRole('worker', 'blank')).toEqual([])
    expect(computerWorkerAllowed('blank')).toBe(false)
    expect(computerWorkerAllowed('code', true)).toBe(false)
    expect(computerWorkerAllowed('coordinator', false)).toBe(true)
  })

  test('batch actions halt on first failure', async () => {
    const batch = await executeComputerBatch(
      [
        { name: 'box_shell', args: { command: 'true' } },
        { name: 'box_shell', args: { command: 'false' } },
        { name: 'box_shell', args: { command: 'true' } },
      ],
      { agentId: 'kernel', display: 2, holderId: 'w1', role: 'worker', kit: 'code' },
      {
        boxExec: (argv) => {
          const cmd = argv.join(' ')
          if (cmd.includes('false')) return { status: 1, text: 'no' }
          return { status: 0, text: 'ok' }
        },
      },
    )
    expect(batch.halted).toBe(true)
    expect(batch.results).toHaveLength(2)
  })

  test('keep last 3 screenshots; stable prefix has no timestamps', () => {
    const trimmed = trimScreenshots([
      { screenshotPath: 'a.png' },
      { screenshotPath: 'b.png' },
      { screenshotPath: 'c.png' },
      { screenshotPath: 'd.png' },
    ])
    expect(trimmed.map((row) => row.screenshotPath)).toEqual([undefined, 'b.png', 'c.png', 'd.png'])
    const prefix = stableComputerPrefix({ agentName: 'Kernel', display: 2, goal: 'open example.com' })
    expect(prefixHasTimestamp(prefix)).toBe(false)
    expect(prefix).toContain('DISPLAY :2')
    expect(prefix).toContain('Do not declare the Goal complete')
    expect(prefix).not.toContain('open example.com')
    expect(prefix).not.toContain('Task:')
  })
})

describe('computer worker loop', () => {
  test('worker drives box_browser with mocked CDP and does not complete a GoalRun', async () => {
    const leases = createDisplayLeases(() => 1)
    let browsed = ''
    const result = await runComputerWorker({
      agentId: 'kernel',
      agentName: 'Kernel',
      display: 2,
      goal: 'open example.com',
      kit: 'code',
      role: 'worker',
      maxRounds: 4,
      seams: {
        leases,
        browse: (agentId, url) => {
          browsed = `${agentId}:${url}`
          return 'shot.png'
        },
      },
      chat: async (messages) => {
        const last = messages.at(-1)
        if (last?.role === 'user') {
          return { text: '', actions: [{ name: 'box_browser', args: { url: 'https://example.com/' } }] }
        }
        return { text: 'Opened example.com.' }
      },
    })
    expect(browsed).toBe('kernel:https://example.com/')
    expect(result.ok).toBe(true)
    expect(result.spoken).toMatch(/example.com/)
    expect(result.screenshotPath).toBe('shot.png')
    expect(result.rounds).toBeGreaterThan(0)
    expect(result.rounds).toBeLessThanOrEqual(COMPUTER_ROUNDS)
  })

  test('host_read parks on an approval prompt instead of looping', async () => {
    const result = await runComputerWorker({
      agentId: 'staff',
      agentName: 'Chief of Staff',
      display: 1,
      goal: 'list ~/Projects on my Mac',
      kit: 'coordinator',
      role: 'coordinator',
      maxRounds: 4,
      chat: async () => ({ text: '', actions: [{ name: 'host_read', args: { path: '/Users/carypalmer/Projects' } }] }),
    })
    expect(result.ok).toBe(false)
    expect(result.needsApproval).toBe(true)
    expect(result.spoken).toBe(HOST_APPROVAL_PROMPT)
    expect(result.rounds).toBe(1)
  })

  test('Staff role refuses pixel tools on the near side', async () => {
    const result = await executeComputerTool(
      { name: 'box_computer', args: { x: 4, y: 4 } },
      { agentId: 'staff', display: 1, holderId: 'staff-mouth', role: 'coordinator', kit: 'coordinator' },
      { click: () => true },
    )
    expect(result.ok).toBe(false)
    expect(result.spoken).toMatch(/does not pixel-click/i)
  })
})
