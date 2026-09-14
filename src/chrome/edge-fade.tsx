import React from 'react'
import { useTokens } from '../theme'

/** Strip alpha from #RRGGBB or #RRGGBBAA → #RRGGBB. */
export function rgbHex(color: string): string {
  const raw = color.replace('#', '').trim()
  if (raw.length >= 6) return `#${raw.slice(0, 6)}`
  return color.startsWith('#') ? color : `#${color}`
}

/** Same RGB with 00 alpha — two-stop fade end. */
export function transparentHex(color: string): string {
  return `${rgbHex(color)}00`
}

export function edgeFadeBackground(color: string, edge: 'top' | 'bottom') {
  const solid = rgbHex(color)
  const clear = transparentHex(color)
  // CSS angle: 0 = up, 180 = down. Top band fades downward; bottom upward.
  return {
    type: 'linear-gradient' as const,
    angle: edge === 'top' ? 180 : 0,
    stops: [
      { color: solid, position: 0 },
      { color: clear, position: 1 },
    ] as [{ color: string; position: number }, { color: string; position: number }],
  }
}

/**
 * Feed / rail edge-fade spike (Wave 6 P2).
 * Simple opacity ramp via gpuix two-stop linear-gradient — no EdgeFade crate.
 * Does not touch menu/toast fills (frost punch-through stays owned by opaque overlays).
 */
export function EdgeFadeFrame({
  children,
  band = 28,
  top = true,
  bottom = true,
  color,
  testId = 'edge-fade',
  show = true,
}: {
  children: React.ReactNode
  band?: number
  top?: boolean
  bottom?: boolean
  /** Paint color for the opaque stop (defaults to canvas). */
  color?: string
  testId?: string
  /** Spike gate — hide when empty / no overflow. */
  show?: boolean
}) {
  const T = useTokens()
  const fill = color ?? T.canvas
  return (
    <div
      testId={testId}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {children}
      {show && top ? (
        <div
          testId={`${testId}-top`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: band,
            pointerEvents: 'none',
            background: edgeFadeBackground(fill, 'top'),
          }}
        />
      ) : null}
      {show && bottom ? (
        <div
          testId={`${testId}-bottom`}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: band,
            pointerEvents: 'none',
            background: edgeFadeBackground(fill, 'bottom'),
          }}
        />
      ) : null}
    </div>
  )
}
