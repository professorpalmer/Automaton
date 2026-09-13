/**
 * `#` caret-anchored filter. gpuix 0.6.1 Input has no selectionStart —
 * treat the caret as the end of the draft.
 */
export type MentionKind = 'skill' | 'room' | 'agent'

export type MentionItem = {
  kind: MentionKind
  id: string
  label: string
  hint?: string
  insert: string
}

export type MentionQuery = {
  start: number
  query: string
}

const HASH_AT_CARET = /(^|[\s])#([^\s#]*)$/

export function mentionQueryAt(text: string): MentionQuery | null {
  const match = HASH_AT_CARET.exec(text)
  if (!match) return null
  const query = match[2] ?? ''
  const start = text.length - query.length - 1
  return { start, query }
}

export function filterMentions(items: readonly MentionItem[], query: string, cap = 8): MentionItem[] {
  const q = query.trim().toLowerCase()
  const rows = q
    ? items.filter((item) => {
        if (item.label.toLowerCase().includes(q)) return true
        if (item.id.toLowerCase().includes(q)) return true
        if (item.kind.startsWith(q)) return true
        return Boolean(item.hint?.toLowerCase().includes(q))
      })
    : [...items]
  return rows.slice(0, Math.max(0, cap))
}

export function applyMention(text: string, item: MentionItem): string {
  const at = mentionQueryAt(text)
  if (!at) return text
  const insert = item.insert.endsWith(' ') ? item.insert : `${item.insert} `
  return `${text.slice(0, at.start)}${insert}`
}

export function collectMentions(input: {
  agents?: readonly { id: string; name: string; hidden?: boolean }[]
  skills?: readonly { id: string; name: string; enabled?: boolean; description?: string }[]
  rooms?: readonly { id: string; name: string; archived?: boolean }[]
}): MentionItem[] {
  const out: MentionItem[] = []
  for (const skill of input.skills ?? []) {
    if (skill.enabled === false) continue
    out.push({
      kind: 'skill',
      id: skill.id,
      label: skill.name || skill.id,
      hint: skill.description,
      insert: `@${skill.id}`,
    })
  }
  for (const room of input.rooms ?? []) {
    if (room.archived) continue
    const token = /\s/.test(room.name) ? room.id : room.name
    out.push({
      kind: 'room',
      id: room.id,
      label: room.name,
      insert: `#${token}`,
    })
  }
  for (const agent of input.agents ?? []) {
    if (agent.hidden) continue
    out.push({
      kind: 'agent',
      id: agent.id,
      label: agent.name,
      insert: agent.name,
    })
  }
  return out
}
