export function runningTests(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST)
}

/** GPUIX motion duration is seconds. Tests paint the end state in one flush. */
export function clockDuration(seconds: number): number {
  return runningTests() ? 0 : seconds
}
