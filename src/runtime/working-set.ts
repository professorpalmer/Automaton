import type { Agent, Thread } from '../domain'

export const TAIL = 8

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

export type ClaimSource = 'job' | 'mouth'

export type Claim = {
  id: string
  ownerAgentId: string
  text: string
  source: ClaimSource
  jobId?: string
}

export type ClaimRef = Pick<Claim, 'ownerAgentId' | 'text'>

export function systemPrompt(agent: Agent): string {
  return [
    `You are ${agent.name}, ${agent.title} in Automaton staff.`,
    agent.description,
    'Speak briefly. Do not print job ids. Workers stay mute; you are the mouth.',
    'If recalled claims answer the user, use them. Do not re-derive a stored finding.',
    'Do not ask how you can assist.',
  ].join(' ')
}

/** Query-vs-inference: a stored claim is an asset. Do not spend a token to restate it. */
export function queryFirst(query: string, claims: ClaimRef[]): string | null {
  if (claims.length === 0) return null
  const q = query.toLowerCase()
  if (!/\b(what did|what was|finding|you (found|said)|last (job|result)|remember)\b/.test(q)) {
    return null
  }
  if (/\bkernel\b/.test(q)) {
    return claims.find((row) => row.ownerAgentId === 'kernel')?.text ?? null
  }
  if (/\bresearch\b/.test(q)) {
    return claims.find((row) => row.ownerAgentId === 'research')?.text ?? null
  }
  return claims[0]?.text ?? null
}

export function buildWorkingSet(input: {
  agent: Agent
  thread: Thread
  claims: ClaimRef[]
}): ChatTurn[] {
  const messages: ChatTurn[] = [{ role: 'system', content: systemPrompt(input.agent) }]
  if (input.claims.length > 0) {
    messages.push({
      role: 'system',
      content: `Recalled claims (sqlite, not transcript):\n${input.claims
        .slice(0, TAIL)
        .map((row) => `- ${row.ownerAgentId}: ${row.text}`)
        .join('\n')}`,
    })
  }
  const tail = input.thread.items.filter((item) => item.kind === 'msg').slice(-TAIL)
  for (const item of tail) {
    if (item.kind !== 'msg') continue
    messages.push({
      role: item.from === 'user' ? 'user' : 'assistant',
      content: item.text,
    })
  }
  return messages
}
