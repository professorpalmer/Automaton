import { sweepHostChrome } from './chrome'
import { runningTests } from './test-env'

/** Sweep leaked host Chrome, then exit. Tests are a no-op. */
export function quitAutomaton(): void {
  if (runningTests()) return
  sweepHostChrome()
  process.exit(0)
}
