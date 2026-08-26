import React from 'react'
import { render } from '@gpuix/react'
import { App } from './app'

render(<App />, {
  title: 'Automaton',
  width: 1100,
  height: 720,
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: 16,
  trafficLightY: 17,
})
