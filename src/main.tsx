import React from 'react'
import { render } from '@gpuix/react'
import { App } from './app'
import { T } from './tokens'

render(<App />, {
  title: 'Automaton',
  width: T.window.width,
  height: T.window.height,
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: T.window.trafficLightX,
  trafficLightY: T.window.trafficLightY,
  debugFrameOverlay: process.env.AUTOMATON_PERF === '1' ? 'minimal' : 'hidden',
})
