/**
 * Activity / takeover: auto-open while streaming; header press locks open/closed.
 * Wave 4 P2: ephemeral session commands/files keep a collapsed strip after stream.
 * No clocks — paint only when streaming, held, or session activity is present.
 */
export type ActivityTakeover = {
  streaming: boolean
  /** null = follow stream; true/false = user took over. */
  held: boolean | null
  /** Ephemeral per-sister commands/files this session (not a second audit DB). */
  hasSessionActivity?: boolean
}

export function activityVisible(state: ActivityTakeover): boolean {
  if (state.held === true) return true
  if (state.held === false) return false
  // Mouth wait is MouthWaitBubble — Activity bar only for real steps/session rows.
  if (state.streaming && state.hasSessionActivity) return true
  // Collapsed strip after the turn when this sister ran commands/files.
  if (state.hasSessionActivity) return true
  return false
}

export function activityExpanded(state: ActivityTakeover): boolean {
  if (state.held != null) return state.held
  // Auto-open only when there is session activity to disclose while streaming.
  return state.streaming && Boolean(state.hasSessionActivity)
}

export function pressActivityHeader(state: ActivityTakeover): ActivityTakeover {
  return { ...state, held: !activityExpanded(state) }
}

export function activityPaintKey(state: ActivityTakeover, foldKey = ''): string {
  if (!activityVisible(state)) return 'parked'
  const live = state.streaming ? 'live' : state.hasSessionActivity ? 'session' : 'held'
  return `${activityExpanded(state) ? 'open' : 'shut'}:${live}:${foldKey}`
}
