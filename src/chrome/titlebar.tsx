import React from 'react'
import { MARK_PATH, PRODUCT } from '../brand'
import { runningTests } from '../runtime/test-env'
import { useTokens } from '../theme'
import { controlClusterStyle, titlebarHitStyle, titlebarLeadStyle, titlebarRowStyle } from './layout'
import { Tip } from './tooltip'

const inspectArmed = { current: false }

function DeskMark() {
  const T = useTokens()
  const size = T.size.badge
  const screenH = 9
  const neckW = T.space.xxs
  const neckH = T.space.xs
  const baseW = 10
  const baseH = T.space.xxs
  return (
    <div
      testId="titlebar-computer-icon"
      style={{
        width: size,
        height: size,
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size,
          height: screenH,
          backgroundColor: T.secondary,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: (size - neckW) / 2,
          top: screenH,
          width: neckW,
          height: neckH,
          backgroundColor: T.secondary,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: (size - baseW) / 2,
          top: screenH + neckH,
          width: baseW,
          height: baseH,
          backgroundColor: T.secondary,
        }}
      />
    </div>
  )
}

export function Titlebar({
  name,
  version = '',
  onInspect,
  onJobs,
}: {
  name: string
  version?: string
  onInspect: () => void
  onJobs: () => void
}) {
  const T = useTokens()
  const inspect = () => {
    onInspect()
  }
  return (
    <div testId="titlebar" style={titlebarRowStyle(T)}>
      <div style={titlebarLeadStyle(T)}>
        <img
          src={MARK_PATH}
          alt=""
          objectFit="contain"
          style={{ width: T.brand.mark, height: T.brand.mark, pointerEvents: 'none' }}
        />
        <div testId="titlebar-brand" style={{ fontSize: T.type.md, color: T.text }}>
          {PRODUCT}
        </div>
        <div testId="titlebar-name" style={{ fontSize: T.type.sm, color: T.secondary }}>
          {name}
        </div>
        {version ? (
          <div
            testId="titlebar-version"
            style={{
              fontSize: T.type.xs,
              color: T.tertiary,
              paddingLeft: T.space.sm,
              paddingRight: T.space.sm,
              paddingTop: 2,
              paddingBottom: 2,
              borderRadius: T.radius.sm,
              borderWidth: T.stroke.hairline,
              borderColor: T.border,
            }}
          >
            {version}
          </div>
        ) : null}
      </div>
      <div style={{ flexGrow: 1 }} />
      <div style={controlClusterStyle(T)}>
        <Tip testId="titlebar-computer-tip" label="Inspector — computer & kit" side="bottom">
          <div
            testId="titlebar-computer"
            style={titlebarHitStyle(T)}
            onMouseDown={
              runningTests()
                ? undefined
                : (event) => {
                    if (event.isRightClick || event.button === 2) return
                    inspectArmed.current = true
                    inspect()
                  }
            }
            onClick={(event) => {
              if (event.isRightClick || event.button === 2) return
              if (inspectArmed.current) {
                inspectArmed.current = false
                return
              }
              inspect()
            }}
          >
            <DeskMark />
          </div>
        </Tip>
        <Tip testId="titlebar-jobs-tip" label="Jobs board (Cmd+J)" side="bottom">
          <div
            testId="titlebar-jobs"
            style={{
              ...titlebarHitStyle(T),
              paddingLeft: T.space.sm,
              paddingRight: T.space.sm,
              fontSize: T.type.xs,
              color: T.secondary,
            }}
            onClick={(event) => {
              if (event.isRightClick || event.button === 2) return
              onJobs()
            }}
          >
            Jobs
          </div>
        </Tip>
      </div>
    </div>
  )
}
