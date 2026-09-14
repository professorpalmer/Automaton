/**
 * Live keyboard chord catalog (Wave 6 P2).
 *
 * One table feeds Settings / palette Shortcuts help — never a stale markdown
 * list. Runtime matchers stay in `inspector.tsx` + `paste-hotkey.ts`; keep
 * labels here in sync when adding a chord.
 */

export type KeymapEntry = {
  id: string
  chord: string
  action: string
  /** Settings / palette grouping */
  group: 'Focus' | 'Chrome' | 'Edit' | 'App'
}

export const KEYMAP: readonly KeymapEntry[] = [
  { id: 'focus-composer', chord: 'Cmd+L', action: 'Focus composer', group: 'Focus' },
  { id: 'toggle-rail', chord: 'Cmd+B', action: 'Toggle rail compact', group: 'Chrome' },
  { id: 'settings', chord: 'Cmd+,', action: 'Toggle Settings', group: 'Chrome' },
  { id: 'jobs', chord: 'Cmd+J', action: 'Toggle Jobs', group: 'Chrome' },
  { id: 'palette', chord: 'Cmd+K', action: 'Toggle command palette', group: 'Chrome' },
  { id: 'inspector', chord: 'Cmd+Shift+I', action: 'Toggle Inspector', group: 'Chrome' },
  { id: 'copy', chord: 'Cmd+C', action: 'Copy selection', group: 'Edit' },
  { id: 'paste', chord: 'Cmd+V', action: 'Paste', group: 'Edit' },
  { id: 'cut', chord: 'Cmd+X', action: 'Cut', group: 'Edit' },
  { id: 'select-all', chord: 'Cmd+A', action: 'Select all (feed)', group: 'Edit' },
  { id: 'quit', chord: 'Cmd+Q', action: 'Quit', group: 'App' },
  { id: 'close', chord: 'Cmd+W', action: 'Quit (close)', group: 'App' },
] as const

export function keymapByGroup(): { group: KeymapEntry['group']; entries: KeymapEntry[] }[] {
  const order: KeymapEntry['group'][] = ['Focus', 'Chrome', 'Edit', 'App']
  return order.map((group) => ({
    group,
    entries: KEYMAP.filter((row) => row.group === group),
  }))
}

export function keymapChord(id: string): string | undefined {
  return KEYMAP.find((row) => row.id === id)?.chord
}
