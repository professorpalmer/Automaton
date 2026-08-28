import { runningTests } from './test-env'

let lastTestCopy: string | null = null

export function copiedInTests(): string | null {
  return lastTestCopy
}

/** GPUI paints text without glyph selection. Copy selected bubbles onto the Mac pasteboard. */
export function copyTextToClipboard(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (runningTests()) {
    lastTestCopy = body
    return true
  }
  try {
    const child = Bun.spawnSync(['pbcopy'], { stdin: Buffer.from(body, 'utf8') })
    return child.exitCode === 0
  } catch {
    return false
  }
}
