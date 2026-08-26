export const DEAL_SHAPES = [
  'blob',
  'pebble',
  'bean',
  'egg',
  'squircle',
  'tablet',
  'capsule',
  'cylinder',
  'hex',
  'gem',
  'crystal',
  'wedge',
  'shield',
  'dome',
  'arch',
  'cloud',
  'teardrop',
  'leaf',
] as const

export type DealShape = (typeof DEAL_SHAPES)[number]

export const DEAL_HUES = [
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'violet',
  'magenta',
  'gray',
] as const

export type DealHue = (typeof DEAL_HUES)[number]

export type DealtMark = { shape: DealShape; color: DealHue }

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619
const SHAPE_MIX_A = 73244475
const SHAPE_MIX_B = 3266489909
/** Hue stream that reproduces host deals for staff / kernel / research. */
const HUE_STREAM_XOR = 12

export const SEED_OVERRIDE: Record<string, { shape: string; color: string }> = {
  staff: { shape: 'blob', color: 'staff' },
  kernel: { shape: 'hex', color: 'kernel' },
  research: { shape: 'tablet', color: 'research' },
}

function fnv1a(text: string): number {
  let hash = FNV_OFFSET >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

function mix(hash: number): number {
  let value = hash >>> 0
  value = Math.imul(value ^ (value >>> 16), SHAPE_MIX_A) >>> 0
  value = Math.imul(value ^ (value >>> 13), SHAPE_MIX_B) >>> 0
  return (value ^ (value >>> 16)) >>> 0
}

function pick<T>(hash: number, items: readonly T[]): T {
  return items[hash % items.length]
}

export function deal(agentId: string): DealtMark {
  const hashed = fnv1a(agentId)
  return {
    shape: pick(mix(hashed), DEAL_SHAPES),
    color: pick(mix(hashed ^ HUE_STREAM_XOR), DEAL_HUES),
  }
}

export function seedOverride(agentId: string): { shape: string; color: string } | null {
  return SEED_OVERRIDE[agentId] ?? null
}

export function markForId(agentId: string, profile?: { avatarShape: string; avatarColor: string } | null): {
  shape: string
  color: string
} {
  if (profile?.avatarShape && profile.avatarColor) {
    return { shape: profile.avatarShape, color: profile.avatarColor }
  }
  return seedOverride(agentId) ?? deal(agentId)
}
