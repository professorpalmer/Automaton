import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { classifyPath, hashFile, ingestPath, safeName } from '../src/runtime/attachments'
import { resetIdsForTests } from '../src/domain'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-att-${Date.now()}-${Math.random()}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('attachments', () => {
  test('safe names drop path separators and classify image vs file', () => {
    expect(safeName('../../secret key.png')).toBe('secret_key.png')
    expect(classifyPath('shot.png').kind).toBe('image')
    expect(classifyPath('notes.pdf').kind).toBe('file')
  })

  test('ingest copies into inbox and hashes bytes, not sqlite', () => {
    resetIdsForTests()
    const home = tmpHome()
    const source = join(home, 'source.png')
    writeFileSync(source, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))
    const row = ingestPath('staff', source, 'att_1', home)
    expect(row.path).toContain(`${join('inbox', 'staff')}`)
    expect(row.kind).toBe('image')
    expect(row.hash).toBe(hashFile(row.path))
    expect(readFileSync(row.path).equals(readFileSync(source))).toBe(true)
    expect(JSON.stringify(row)).not.toMatch(/137,80,78,71/)
    rmSync(home, { recursive: true, force: true })
  })
})
