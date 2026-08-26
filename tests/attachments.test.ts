import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  classifyPath,
  hashFile,
  ingestPath,
  insertClipboardText,
  pickLocalFiles,
  CHOOSE_FILE_SCRIPT,
  readClipboardPaths,
  readClipboardText,
  safeName,
} from '../src/runtime/attachments'
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
    expect(classifyPath('clip.tiff').kind).toBe('image')
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

  test('clipboard env seam queues listed paths without osascript', () => {
    const png = join(tmpHome(), 'shot.png')
    mkdirSync(join(png, '..'), { recursive: true })
    writeFileSync(png, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(readClipboardPaths({ env: { AUTOMATON_CLIP_FILES: png }, bunTest: true })).toEqual([png])
  })

  test('tests do not read the live pasteboard', () => {
    const scripts: string[] = []
    expect(
      readClipboardPaths({
        env: { BUN_TEST: '1' },
        bunTest: true,
        platform: 'darwin',
        run: (script) => {
          scripts.push(script)
          return { ok: true, stdout: '«class PNGf»' }
        },
      }),
    ).toEqual([])
    expect(scripts).toEqual([])
  })

  test('text clipboard skips image write', () => {
    const scripts: string[] = []
    expect(
      readClipboardPaths({
        bunTest: false,
        platform: 'darwin',
        env: {},
        tmp: tmpHome(),
        now: () => 1,
        run: (script) => {
          scripts.push(script)
          if (script === 'clipboard info') return { ok: true, stdout: '«class utf8», string' }
          throw new Error(`unexpected ${script.slice(0, 40)}`)
        },
      }),
    ).toEqual([])
    expect(scripts).toEqual(['clipboard info'])
  })

  test('text plus TIFF preview skips image write', () => {
    const scripts: string[] = []
    expect(
      readClipboardPaths({
        bunTest: false,
        platform: 'darwin',
        env: {},
        tmp: tmpHome(),
        now: () => 1,
        run: (script) => {
          scripts.push(script)
          if (script === 'clipboard info') return { ok: true, stdout: '«class utf8», string, «class TIFF»' }
          throw new Error(`unexpected ${script.slice(0, 40)}`)
        },
      }),
    ).toEqual([])
    expect(scripts).toEqual(['clipboard info'])
  })

  test('clipboard text seam returns the string and does not spawn', () => {
    const scripts: string[] = []
    expect(
      readClipboardText({
        bunTest: true,
        platform: 'darwin',
        env: { AUTOMATON_CLIP_TEXT: 'hello from paste' },
        run: (script) => {
          scripts.push(script)
          return { ok: true, stdout: 'no' }
        },
      }),
    ).toBe('hello from paste')
    expect(scripts).toEqual([])
    expect(insertClipboardText('', 'hello from paste')).toBe('hello from paste')
    expect(insertClipboardText('hello from paste', 'hello from paste')).toBe('hello from paste')
    expect(insertClipboardText('hi ', 'there')).toBe('hi there')
  })

  test('clipboard png write validates magic and returns dest', () => {
    const home = tmpHome()
    const paths = readClipboardPaths({
      bunTest: false,
      platform: 'darwin',
      env: {},
      tmp: home,
      now: () => 1,
      run: (script) => {
        if (script === 'clipboard info') return { ok: true, stdout: '«class PNGf»' }
        if (script.includes('PNGf')) {
          const match = /POSIX file "([^"]+)"/.exec(script)
          const dest = match?.[1]
          if (!dest) return { ok: false, stdout: 'no' }
          writeFileSync(dest, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))
          return { ok: true, stdout: 'ok' }
        }
        return { ok: true, stdout: 'no' }
      },
    })
    expect(paths).toEqual([join(home, 'automaton-clip-1.png')])
    expect(existsSync(paths[0])).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  test('clipboard files materialize existing aliases', () => {
    const home = tmpHome()
    const source = join(home, 'copied.pdf')
    writeFileSync(source, 'notes')
    expect(
      readClipboardPaths({
        bunTest: false,
        platform: 'darwin',
        env: {},
        tmp: home,
        now: () => 2,
        run: (script) => {
          if (script === 'clipboard info') return { ok: true, stdout: 'alias' }
          if (script.includes('list of alias')) return { ok: true, stdout: source }
          return { ok: true, stdout: 'no' }
        },
      }),
    ).toEqual([source])
    rmSync(home, { recursive: true, force: true })
  })

  test('picker script activates a floating open panel', () => {
    expect(CHOOSE_FILE_SCRIPT).toContain('activateIgnoringOtherApps')
    expect(CHOOSE_FILE_SCRIPT).toContain('NSOpenPanel')
    expect(CHOOSE_FILE_SCRIPT).toContain('setFloatingPanel')
  })

  test('tests do not spawn the live file picker', () => {
    const scripts: string[] = []
    expect(
      pickLocalFiles({
        bunTest: true,
        platform: 'darwin',
        env: {},
        run: (script) => {
          scripts.push(script)
          return { ok: true, stdout: '/tmp/note.txt' }
        },
      }),
    ).toEqual([])
    expect(scripts).toEqual([])
  })

  test('live picker seam uses the activating script', () => {
    expect(
      pickLocalFiles({
        bunTest: false,
        platform: 'darwin',
        env: {},
        run: (script) => {
          expect(script).toContain('activateIgnoringOtherApps')
          return { ok: true, stdout: '/tmp/note.txt' }
        },
      }),
    ).toEqual(['/tmp/note.txt'])
  })
})
