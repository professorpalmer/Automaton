import React from 'react'
import { motion } from '@gpuix/react'
import { motionTransition } from '../motion'
import { useTokens } from '../theme'

/** Slide-over Staff pane — Settings, inspector, Jobs. Parks with paneIn. */
export function Sheet({
  open,
  testId,
  width,
  children,
}: {
  open: boolean
  testId: string
  width?: number
  children: React.ReactNode
}) {
  const T = useTokens()
  const paneWidth = width ?? T.inspector.width
  const next = open ? paneWidth : 0
  return (
    <div
      testId={testId}
      style={{
        width: next,
        height: '100%',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <motion.div
        initial={false}
        animate={{ width: next }}
        transition={motionTransition('paneIn')}
        style={{
          width: next,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: paneWidth, height: '100%', minHeight: 0 }}>{children}</div>
      </motion.div>
    </div>
  )
}
