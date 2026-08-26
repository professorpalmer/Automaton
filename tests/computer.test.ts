import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  BOX_NAME,
  assignDisplay,
  boxProfileDir,
  mouthScreen,
  sameComputer,
} from '../src/runtime/computer'

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
    expect(BOX_NAME).toBe('automaton-computer')
    rmSync(home, { recursive: true, force: true })
  })
})
