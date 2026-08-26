import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { listSkills } from '../src/runtime/skills'

describe('skill library', () => {
  test('lists SKILL.md pins from the computer skills root', () => {
    const home = join(tmpdir(), `automaton-skills-${Date.now()}`)
    mkdirSync(join(home, 'skills', 'scout'), { recursive: true })
    writeFileSync(
      join(home, 'skills', 'scout', 'SKILL.md'),
      `---\nname: Scout\ndescription: Look without implementing.\n---\n\nBe brief.\n`,
    )
    const rows = listSkills(home)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('scout')
    expect(rows[0]?.name).toBe('Scout')
    rmSync(home, { recursive: true, force: true })
  })
})
