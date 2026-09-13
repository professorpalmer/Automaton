import { clockDuration } from '../runtime/test-env'
import { MOTION, type MotionName, type MotionSpec } from './specs'

export type NamedTransition = {
  duration: number
  ease: MotionSpec['curve']
  delay?: number
}

/** gpuix `transition={…}` from a catalog name. Call sites do not write raw ease. */
export function motionTransition(
  name: MotionName,
  override?: { duration?: number; delay?: number },
): NamedTransition {
  const spec = MOTION[name]
  const duration = clockDuration(override?.duration ?? spec.duration)
  const delay = override?.delay ?? spec.delay
  return delay != null ? { duration, ease: spec.curve, delay } : { duration, ease: spec.curve }
}
