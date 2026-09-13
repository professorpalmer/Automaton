/**
 * Activity / takeover: auto-open while streaming; header press locks open/closed.
 * No clocks — paint only when streaming or the user held the zone.
 */
export type ActivityTakeover = {
  streaming: boolean
  /** null = follow stream; true/false = user took over. */
  held: boolean | null
}

export function activityVisible(state: ActivityTakeover): boolean {
  if (state.held === true) return true
  return state.streaming
}

export function activityExpanded(state: ActivityTakeover): boolean {
  if (state.held != null) return state.held
  return state.streaming
}

export function pressActivityHeader(state: ActivityTakeover): ActivityTakeover {
  return { ...state, held: !activityExpanded(state) }
}

export function activityPaintKey(state: ActivityTakeover, foldKey = ''): string {
  if (!activityVisible(state)) return 'parked'
  return `${activityExpanded(state) ? 'open' : 'shut'}:${state.streaming ? 'live' : 'held'}:${foldKey}`
}
