/** Product JobKind verbs only — no Cursor-private kits, no tool ontology. */
export const PRODUCT_VERBS = ['analyze', 'implement', 'shell', 'land', 'ship'] as const

export type ProductVerb = (typeof PRODUCT_VERBS)[number]

export type StepTrace = {
  verb: string
  detail: string
}

export type FoldedStep = {
  verb: string
  detail: string
  count: number
  items: StepTrace[]
}

/** Map a job kind (or already-labeled verb) onto product vocabulary. */
export function productVerb(kind: string): string {
  const raw = kind.trim().toLowerCase()
  if (raw === 'box-shell' || raw === 'shell') return 'shell'
  if (raw === 'promote' || raw === 'land') return 'land'
  if (raw === 'analyze' || raw === 'implement' || raw === 'ship') return raw
  return raw || 'look'
}

/** Stringy step row: verb + detail. The UI lib does not know tools. */
export function stepRow(verb: string, detail?: string): string {
  const v = productVerb(verb)
  const d = (detail ?? '').trim()
  if (!d) return v
  return `${v} ${d}`
}

/** Fold consecutive traces that share a verb. Header stays stringy. */
export function foldStepsByVerb(rows: readonly StepTrace[]): FoldedStep[] {
  const groups: FoldedStep[] = []
  for (const row of rows) {
    const verb = productVerb(row.verb)
    const detail = row.detail.trim()
    const last = groups[groups.length - 1]
    if (last && last.verb === verb) {
      last.items.push({ verb, detail })
      last.count += 1
      last.detail = last.count === 1 ? detail : `${last.count} ${verb}`
      continue
    }
    groups.push({
      verb,
      detail,
      count: 1,
      items: [{ verb, detail }],
    })
  }
  return groups
}

export function tracesFromJob(job: {
  kind: string
  goal: string
  lastNote?: string
  evidence?: string[]
}): StepTrace[] {
  const verb = productVerb(job.kind)
  const details = [job.lastNote, ...(job.evidence ?? [])].map((row) => row?.trim() ?? '').filter(Boolean)
  if (details.length === 0) {
    const goal = job.goal.trim()
    return goal ? [{ verb, detail: goal }] : [{ verb, detail: '' }]
  }
  return details.map((detail) => ({ verb, detail }))
}

export function foldJobTraces(jobs: readonly Parameters<typeof tracesFromJob>[0][]): FoldedStep[] {
  return foldStepsByVerb(jobs.flatMap(tracesFromJob))
}
