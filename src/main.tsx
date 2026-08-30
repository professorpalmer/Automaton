import React from 'react'
import { render } from '@gpuix/react'
import { App } from './app'
import { sweepHostChrome } from './runtime/chrome'
import { applyChromeToTokens, chromeFromSkin, readSkin } from './runtime/skin'
import { T } from './tokens'

applyChromeToTokens(readSkin())
const chrome = chromeFromSkin(readSkin())

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
  windowBackground: chrome.windowBackground,
  trafficLightX: T.window.trafficLightX,
  trafficLightY: T.window.trafficLightY,
  debugFrameOverlay: process.env.AUTOMATON_PERF === '1' ? 'minimal' : 'hidden',
})
