import React from 'react'
import { render } from '@gpuix/react'
import { App } from './app'
import { sweepHostChrome } from './runtime/chrome'
import { T } from './tokens'

function onDie() {
  sweepHostChrome()
  process.exit(0)
}

process.on('SIGINT', onDie)
process.on('SIGTERM', onDie)

render(<App />, {
  title: 'Automaton',
  width: T.window.width,
  height: T.window.height,
  titlebarTransparent: true,
  windowBackground: 'opaque',
  trafficLightX: T.window.trafficLightX,
  trafficLightY: T.window.trafficLightY,
  debugFrameOverlay: process.env.AUTOMATON_PERF === '1' ? 'minimal' : 'hidden',
})
