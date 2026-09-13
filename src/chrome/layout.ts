import { DEFAULT_TOKENS, type Tokens } from '../theme/tokens'

export type ChromePlatform = 'darwin' | 'linux' | 'win32' | string

/** Do not park titlebar content under AppKit traffic lights. */
export function trafficLightClearance(
  tokens: Tokens = DEFAULT_TOKENS,
  platform: ChromePlatform = typeof process !== 'undefined' ? process.platform : 'darwin',
): number {
  return platform === 'darwin' ? tokens.layout.trafficLightClearance : tokens.space.sm
}

export function titlebarRowStyle(
  tokens: Tokens = DEFAULT_TOKENS,
  platform: ChromePlatform = typeof process !== 'undefined' ? process.platform : 'darwin',
) {
  return {
    height: tokens.layout.titlebarHeight,
    display: 'flex' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingLeft: trafficLightClearance(tokens, platform),
    paddingRight: tokens.space.lg,
    gap: tokens.space.sm,
    borderBottomWidth: tokens.stroke.hairline,
    borderBottomColor: tokens.border,
    backgroundColor: tokens.clear,
    flexShrink: 0,
  }
}

/** Leading cluster: mark + word + focused mouth. */
export function titlebarLeadStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    display: 'flex' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: tokens.space.sm,
    minWidth: 0,
    flexGrow: 0,
    flexShrink: 1,
  }
}

/** Trailing control-bar cluster. Stay off the traffic lights. */
export function controlClusterStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    display: 'flex' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: tokens.space.xs,
    flexShrink: 0,
  }
}

export function titlebarHitStyle(tokens: Tokens = DEFAULT_TOKENS) {
  return {
    paddingLeft: tokens.space.xs,
    paddingRight: tokens.space.xs,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
    borderRadius: tokens.radius.sm,
    cursor: 'pointer' as const,
    pointerEvents: 'auto' as const,
    userSelect: 'none' as const,
    hover: { backgroundColor: tokens.raised },
  }
}
