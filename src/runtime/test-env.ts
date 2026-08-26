export function runningTests(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST)
}
