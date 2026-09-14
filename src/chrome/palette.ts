/** Command palette catalog + fuzzy filter. Events only — no command ontology kit. */

export type PaletteSection = 'Sisters' | 'Rooms' | 'Settings' | 'Jobs'

export type PaletteItem = {
  id: string
  section: PaletteSection
  label: string
  hint?: string
  /** Settings section anchor when section === Settings */
  settingsSection?: string
  /** Sister / room id when jumping */
  targetId?: string
}

export const SETTINGS_PALETTE: { id: string; label: string; hint?: string }[] = [
  { id: 'appearance', label: 'Appearance', hint: 'Window · wash · brand' },
  { id: 'keys', label: 'OpenRouter key', hint: 'Secret stays off chat' },
  { id: 'usage', label: 'Usage', hint: 'Ledger' },
  { id: 'mouth', label: 'Mouth context', hint: 'Compact working set' },
  { id: 'connectors', label: 'Connectors', hint: 'OpenRouter mouth' },
  { id: 'providers', label: 'Providers', hint: 'Mouth · Jobs · cloud map' },
  { id: 'mcp', label: 'MCP catalog', hint: 'Connectors registry' },
  { id: 'channels', label: 'Channels', hint: 'Slack' },
  { id: 'rooms', label: 'Rooms', hint: 'Multi-agent rooms' },
  { id: 'routines', label: 'Routines', hint: 'Scheduled wakes' },
  { id: 'skills', label: 'Skills', hint: 'Local / imported' },
  { id: 'computer', label: 'Computer', hint: 'Shared box' },
  { id: 'cloud', label: 'Cloud / Origin', hint: 'Cloud Agents bind' },
  { id: 'about', label: 'About', hint: 'Version' },
]

export function buildPaletteItems(input: {
  agents?: readonly { id: string; name: string; title?: string; hidden?: boolean }[]
  rooms?: readonly { id: string; name: string; archived?: boolean }[]
}): PaletteItem[] {
  const out: PaletteItem[] = []
  for (const agent of input.agents ?? []) {
    if (agent.hidden) continue
    out.push({
      id: `sister:${agent.id}`,
      section: 'Sisters',
      label: agent.name,
      hint: agent.title,
      targetId: agent.id,
    })
  }
  for (const room of input.rooms ?? []) {
    if (room.archived) continue
    out.push({
      id: `room:${room.id}`,
      section: 'Rooms',
      label: room.name,
      hint: 'Room',
      targetId: room.id,
    })
  }
  for (const row of SETTINGS_PALETTE) {
    out.push({
      id: `settings:${row.id}`,
      section: 'Settings',
      label: row.label,
      hint: row.hint,
      settingsSection: row.id,
    })
  }
  out.push({
    id: 'jobs:open',
    section: 'Jobs',
    label: 'Open Jobs',
    hint: 'Board · flying work',
  })
  return out
}

/** Case-insensitive substring fuzzy — prefer startsWith, then includes. */
export function filterPaletteItems(
  items: readonly PaletteItem[],
  query: string,
  cap = 24,
): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return items.slice(0, Math.max(0, cap))
  }
  const scored: { item: PaletteItem; score: number }[] = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    const hint = (item.hint ?? '').toLowerCase()
    const section = item.section.toLowerCase()
    const id = (item.targetId ?? item.settingsSection ?? '').toLowerCase()
    let score = -1
    if (label.startsWith(q)) score = 100
    else if (id.startsWith(q)) score = 90
    else if (label.includes(q)) score = 70
    else if (hint.includes(q)) score = 50
    else if (section.startsWith(q) || section.includes(q)) score = 30
    if (score >= 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
  return scored.slice(0, Math.max(0, cap)).map((row) => row.item)
}

export function groupPaletteItems(items: readonly PaletteItem[]): {
  section: PaletteSection
  items: PaletteItem[]
}[] {
  const order: PaletteSection[] = ['Sisters', 'Rooms', 'Settings', 'Jobs']
  const map = new Map<PaletteSection, PaletteItem[]>()
  for (const section of order) map.set(section, [])
  for (const item of items) {
    const bucket = map.get(item.section)
    if (bucket) bucket.push(item)
  }
  return order
    .map((section) => ({ section, items: map.get(section) ?? [] }))
    .filter((row) => row.items.length > 0)
}
