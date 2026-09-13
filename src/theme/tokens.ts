/** Closed token set. Paint reads an immutable snapshot — never a mutated export. */

export type Tokens = {
  appearance: 'dark'
  canvas: string
  sidebar: string
  raised: string
  selected: string
  composer: string
  overlay: string
  overlayStrong: string
  clear: string
  border: string
  borderStrong: string
  sidebarBorder: string
  text: string
  secondary: string
  tertiary: string
  ghost: string
  accent: string
  inverse: string
  onInverse: string
  danger: string
  menu: string
  menuHover: string
  scrim: string
  space: {
    xxs: number
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
    hero: number
    control: number
    inset: number
  }
  size: {
    badge: number
  }
  staff: { face: string }
  kernel: { face: string }
  research: { face: string }
  brand: {
    yellow: string
    ink: string
    mark: number
  }
  catalog: {
    black: string
    brown: string
    red: string
    orange: string
    yellow: string
    green: string
    cyan: string
    blue: string
    violet: string
    magenta: string
    gray: string
  }
  blob: {
    size: number
    slot: number
    enterSize: number
    selectedLift: number
    wanderMs: number
    blinkEveryMs: number
    blinkMs: number
    eye: number
    eyeGap: number
    eyeX: number
    eyeY: number
    eyeWander: number
    breatheMs: number
    stagger: number
    hover: number
    active: number
  }
  attach: {
    thumb: number
    barMs: number
  }
  desk: {
    viewH: number
    stageMinH: number
    pollMs: number
    hit: string
  }
  inspector: {
    width: number
    settings: number
  }
  jobStrip: {
    height: number
  }
  window: {
    width: number
    height: number
    trafficLightX: number
    trafficLightY: number
  }
  radius: {
    sm: number
    md: number
    lg: number
    xl: number
    badge: number
    pill: number
    control: number
    button: number
    panel: number
    surface: number
    bubble: number
  }
  type: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
  }
  line: {
    sm: number
    md: number
    lg: number
    xl: number
  }
  motion: {
    sidebarMs: number
    blob: number
    enter: number
    strip: number
    pane: number
    selected: number
    unread: number
    breathe: number
  }
  layout: {
    sidebarMin: number
    sidebarCompact: number
    sidebarWidth: number
    sidebarMax: number
    railHandle: number
    titlebarHeight: number
    contentMax: number
    trafficLightClearance: number
    menuMin: number
    menuMax: number
  }
  feed: {
    gutter: number
    stack: number
    turn: number
    mark: number
    padX: number
    padY: number
    max: number
    clockGapMs: number
    thinkMs: number
    copyFlashMs: number
  }
  stroke: {
    none: number
    hairline: number
  }
}

/** Graphite dark snapshot. Skin/Brand replace this object; they never mutate it. */
export const DEFAULT_TOKENS: Tokens = {
  appearance: 'dark',
  canvas: '#10101014',
  sidebar: '#FFFFFF0A',
  raised: '#FFFFFF0D',
  selected: '#FFFFFF1A',
  composer: '#FFFFFF38',
  overlay: '#E6EAF214',
  overlayStrong: '#E6EAF224',
  clear: '#00000000',
  border: '#FFFFFF1F',
  borderStrong: '#FFFFFF33',
  sidebarBorder: '#FFFFFF1F',
  text: '#F2F2F2',
  secondary: '#F2F2F2',
  tertiary: '#E8E8E8',
  ghost: '#D8D8D8',
  accent: '#D4D4D4',
  inverse: '#ECECEC',
  onInverse: '#181818',
  danger: '#C45C5C',
  menu: '#1A1A1A',
  menuHover: '#2A2A2A',
  scrim: '#00000099',
  space: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    hero: 32,
    control: 6,
    inset: 5,
  },
  size: {
    badge: 16,
  },
  staff: {
    face: '#C8C8C8',
  },
  kernel: {
    face: '#00C972',
  },
  research: {
    face: '#1084FE',
  },
  brand: {
    yellow: '#F0C000',
    ink: '#111111',
    mark: 20,
  },
  catalog: {
    black: '#000000',
    brown: '#936439',
    red: '#FF263C',
    orange: '#FF6700',
    yellow: '#FF9800',
    green: '#00C972',
    cyan: '#00BCA6',
    blue: '#1084FE',
    violet: '#9159FE',
    magenta: '#FF309B',
    gray: '#777777',
  },
  blob: {
    size: 38,
    slot: 46,
    enterSize: 28,
    selectedLift: -3,
    wanderMs: 1600,
    blinkEveryMs: 3800,
    blinkMs: 140,
    eye: 4,
    eyeGap: 7,
    eyeX: 22,
    eyeY: 14,
    eyeWander: 4,
    breatheMs: 2000,
    stagger: 0.05,
    hover: 0.92,
    active: 0.8,
  },
  attach: {
    thumb: 96,
    barMs: 0.16,
  },
  desk: {
    viewH: 158,
    stageMinH: 420,
    pollMs: 750,
    hit: '#FFFFFF03',
  },
  inspector: {
    width: 280,
    settings: 400,
  },
  jobStrip: {
    height: 48,
  },
  window: {
    width: 1280,
    height: 860,
    trafficLightX: 16,
    trafficLightY: 17,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 18,
    badge: 8,
    pill: 999,
    control: 6,
    button: 10,
    panel: 14,
    surface: 18,
    bubble: 8,
  },
  type: {
    xs: 11,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 22,
  },
  line: {
    sm: 16,
    md: 20,
    lg: 24,
    xl: 28,
  },
  motion: {
    sidebarMs: 200,
    blob: 0.22,
    enter: 0.28,
    strip: 0.2,
    pane: 0.2,
    selected: 0.16,
    unread: 0.2,
    breathe: 2,
  },
  layout: {
    sidebarMin: 72,
    sidebarCompact: 140,
    sidebarWidth: 268,
    sidebarMax: 380,
    railHandle: 8,
    titlebarHeight: 52,
    contentMax: 760,
    trafficLightClearance: 86,
    menuMin: 160,
    menuMax: 280,
  },
  feed: {
    gutter: 28,
    stack: 8,
    turn: 28,
    mark: 18,
    padX: 18,
    padY: 14,
    max: 680,
    clockGapMs: 15 * 60 * 1000,
    thinkMs: 400,
    copyFlashMs: 1200,
  },
  stroke: {
    none: 0,
    hairline: 1,
  },
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  Object.freeze(value)
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child)
  }
  return value
}

freezeDeep(DEFAULT_TOKENS)

/** Frozen default snapshot. Skin replaces a copy; do not assign fields. */
export const T = DEFAULT_TOKENS
