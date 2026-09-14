import React from 'react'
import { motion } from '@gpuix/react'
import { thinkingDots } from '../domain'
import { useTokens } from '../theme'

/**
 * Compact mouth wait in the assistant bubble slot — not a full-width Thinking bar.
 * Soft opacity pulse via gpuix motion (no JS clock).
 */
export function MouthWaitBubble() {
  const T = useTokens()
  return (
    <div
      style={{
        width: '100%',
        paddingLeft: T.feed.gutter,
        paddingRight: T.feed.gutter,
        paddingTop: T.feed.turn,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
      }}
    >
      <motion.div
        testId="thinking"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          maxWidth: T.feed.max,
          alignSelf: 'flex-start',
          backgroundColor: T.composer,
          borderRadius: T.radius.xl,
          borderWidth: T.stroke.hairline,
          borderColor: T.border,
          paddingTop: T.feed.padY,
          paddingBottom: T.feed.padY,
          paddingLeft: T.feed.padX,
          paddingRight: T.feed.padX,
          fontSize: T.type.md,
          lineHeight: T.line.lg,
          minHeight: T.line.lg,
          color: T.ghost,
          letterSpacing: 1,
        }}
      >
        {thinkingDots(3)}
      </motion.div>
    </div>
  )
}
