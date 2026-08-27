/** Who has the wheel. Pixel/CDP refuse while the person has Take control. Fail open. */

export type Driver = 'human' | 'worker' | 'unknown'

const PIXEL_TOOLS = new Set(['box_computer', 'box_browser'])

const driving = new Map<number, Driver>()

export function isPixelOrCdpTool(name: string): boolean {
  return PIXEL_TOOLS.has(name)
}

export function setHumanDriving(display: number, on: boolean): void {
  try {
    if (on) driving.set(display, 'human')
    else if (driving.get(display) === 'human') driving.delete(display)
  } catch {
    /* fail open: a harness hiccup must not brick the computer */
  }
}

export function setWorkerDriving(display: number, on: boolean): void {
  try {
    if (on) {
      if (driving.get(display) === 'human') return
      driving.set(display, 'worker')
    } else if (driving.get(display) === 'worker') driving.delete(display)
  } catch {
    /* fail open */
  }
}

export function whoIsDriving(display: number): Driver {
  try {
    return driving.get(display) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export type DriveRefuse = { refuse: true; reason: 'human_driving' } | { refuse: false }

/** Near-side refuse. Never enqueue behind the human. Unknown fails open. */
export function refuseWhileHumanDriving(tool: string, display: number): DriveRefuse {
  try {
    if (!isPixelOrCdpTool(tool)) return { refuse: false }
    if (whoIsDriving(display) === 'human') return { refuse: true, reason: 'human_driving' }
    return { refuse: false }
  } catch {
    return { refuse: false }
  }
}

export function humanDrivingSpoken(): string {
  return 'The operator has the screen. Waiting until they hand it back.'
}

export function resetDrivingForTests(): void {
  driving.clear()
}
