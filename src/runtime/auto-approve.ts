import type { QuestionWidget } from '../domain'

/** Who started this turn. Auto may only follow a user-authored kickoff. */
export type TurnKickoff = 'user' | 'webhook' | 'routine' | 'peer-hop' | 'intro' | 'unknown'

export type ApprovalDecision = 'auto' | 'ask' | 'deny'

export type ApprovalGrantKind = 'once' | 'always'

export type ApprovalGrant = {
  scope: string
  kind: ApprovalGrantKind
}

export type PendingApproval = {
  id: string
  workerId?: string
  action: string
  kickoff: TurnKickoff
}

export type ApprovalInput = {
  action: string
  kickoff: TurnKickoff
  autoEnabled: boolean
  brokerAlive: boolean
  grants?: ApprovalGrant[]
}

export type ApprovalOutcome = {
  decision: ApprovalDecision
  grants: ApprovalGrant[]
  reason:
    | 'unattended'
    | 'destructive'
    | 'dead-broker'
    | 'auto'
    | 'ask'
    | 'grant-once'
    | 'grant-always'
}

export const UNATTENDED_SOURCES = ['webhook', 'routine', 'peer-hop', 'intro', 'unknown'] as const

/**
 * Extra ask on obvious host damage. This is not a sandbox and not a permit:
 * a non-match still has to pass unattended / Auto / broker checks.
 */
const SENSITIVE =
  /\.env(?:\b|rc|\.local|\.development|\.production)?|\.ssh\b|\brm\s+-[a-zA-Z]*rf\b|\brm\s+-[a-zA-Z]*fr\b|\bgit\s+push\b[^\n]*\s(?:--force|--force-with-lease|-f)\b|\bforce-push\b/i

export function isUserKickoff(kickoff: TurnKickoff): boolean {
  return kickoff === 'user'
}

export function isUnattended(kickoff: TurnKickoff): boolean {
  return !isUserKickoff(kickoff)
}

export function looksSensitive(action: string): boolean {
  return SENSITIVE.test(action)
}

export function scopeForAction(action: string): string {
  return action.trim().replace(/\s+/g, ' ')
}

export function consumeGrant(
  grants: ApprovalGrant[],
  scope: string,
): { grants: ApprovalGrant[]; kind: ApprovalGrantKind | null } {
  const hit = grants.findIndex((row) => row.scope === scope)
  if (hit < 0) return { grants, kind: null }
  const grant = grants[hit]
  if (!grant) return { grants, kind: null }
  if (grant.kind === 'always') return { grants, kind: 'always' }
  return { grants: grants.filter((_, index) => index !== hit), kind: 'once' }
}

/** allowed-once is consumed. It never becomes Always-allow / Auto. */
export function grantOnce(grants: ApprovalGrant[], scope: string): ApprovalGrant[] {
  const next = grants.filter((row) => row.scope !== scope || row.kind === 'always')
  next.push({ scope, kind: 'once' })
  return next
}

/**
 * OpenMaus: Auto must not follow a turn nobody started.
 * Dead broker denies. Destructive still asks. Regex is not the sandbox.
 */
export function decideApproval(input: ApprovalInput): ApprovalOutcome {
  const grants = input.grants ?? []
  if (!input.brokerAlive) return { decision: 'deny', grants, reason: 'dead-broker' }
  if (isUnattended(input.kickoff)) return { decision: 'ask', grants, reason: 'unattended' }
  if (looksSensitive(input.action)) return { decision: 'ask', grants, reason: 'destructive' }
  const consumed = consumeGrant(grants, scopeForAction(input.action))
  if (consumed.kind === 'always') {
    return { decision: 'auto', grants: consumed.grants, reason: 'grant-always' }
  }
  if (consumed.kind === 'once') {
    return { decision: 'auto', grants: consumed.grants, reason: 'grant-once' }
  }
  if (input.autoEnabled) return { decision: 'auto', grants, reason: 'auto' }
  return { decision: 'ask', grants, reason: 'ask' }
}

export function cancelPendingApprovals(pending: PendingApproval[]): PendingApproval[] {
  return pending.length === 0 ? pending : []
}

export function unattendedApprovalWidget(
  source: 'webhook' | 'routine' | 'peer-hop',
  prompt?: string,
): QuestionWidget {
  const label = source === 'peer-hop' ? 'peer hop' : source
  return {
    prompt: prompt ?? `Approve this ${label} action?`,
    options: [
      { label: 'Run', value: 'run', style: 'primary' },
      { label: 'Cancel', value: 'cancel', style: 'danger' },
    ],
  }
}
