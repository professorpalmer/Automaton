/**
 * Verified OpenRouter provider maps (opengrok laws, TypeScript).
 * Unverified route -> label "none" and leave the body untouched.
 * No capture, no map. Never ship a half-map.
 */
export type MapParam = { id: string; value: unknown }

export type ProviderMapContext = {
  modelId?: string
  baseUrl?: string
  maxMode?: boolean
  parameters?: MapParam[]
  effort?: string
  thinking?: boolean | string
  fast?: boolean | string
}

const GROK_MODEL_RE = /^grok[-.]/i
const CLAUDE_MODEL_RE = /^claude[-.]/i
const GEMINI_MODEL_RE = /^gemini/i
const GEMINI_TIERED_FAMILY_RE = /^gemini-3\.6-flash$/i
const DEEPSEEK_MODEL_RE = /deepseek/i
const GLM_MODEL_RE = /^glm[-.\d]/i

const EFFORT_TO_XAI: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
  xhigh: 'xhigh',
  minimal: 'low',
}

const GLM_EFFORT: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
  xhigh: 'max',
  maximal: 'max',
}

const GEMINI_EFFORT_TO_SLUG: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high',
  xhigh: 'high',
}

function modelSlug(modelId: string): string {
  const raw = String(modelId || '')
  const slash = raw.lastIndexOf('/')
  return slash >= 0 ? raw.slice(slash + 1) : raw
}

function param(parameters: MapParam[] | undefined, id: string): unknown {
  if (!Array.isArray(parameters)) return undefined
  for (const item of parameters) {
    if (item && item.id === id) return item.value
  }
  return undefined
}

function isTrue(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true'
}

function isFalse(value: unknown): boolean {
  return value === false || String(value).toLowerCase() === 'false'
}

function controlsOf(ctx: ProviderMapContext): MapParam[] {
  const out = Array.isArray(ctx.parameters) ? [...ctx.parameters] : []
  const has = (id: string) => out.some((item) => item && item.id === id)
  if (ctx.effort != null && !has('effort')) out.push({ id: 'effort', value: ctx.effort })
  if (ctx.fast != null && !has('fast')) out.push({ id: 'fast', value: ctx.fast })
  if (ctx.thinking != null && !has('thinking')) out.push({ id: 'thinking', value: ctx.thinking })
  return out
}

export function isGrokRoute(modelId: string, baseUrl = ''): boolean {
  const id = String(modelId || '')
  if (GROK_MODEL_RE.test(id) || GROK_MODEL_RE.test(modelSlug(id))) return true
  return /127\.0\.0\.1:18779/.test(String(baseUrl || ''))
}

export function isClaudeRoute(modelId: string, baseUrl = ''): boolean {
  const id = String(modelId || '')
  if (CLAUDE_MODEL_RE.test(id) || CLAUDE_MODEL_RE.test(modelSlug(id))) return true
  return /127\.0\.0\.1:18776/.test(String(baseUrl || ''))
}

export function isGeminiRoute(modelId: string, baseUrl = ''): boolean {
  const id = String(modelId || '')
  if (GEMINI_MODEL_RE.test(id) || GEMINI_MODEL_RE.test(modelSlug(id))) return true
  return /127\.0\.0\.1:18778/.test(String(baseUrl || ''))
}

export function isDeepSeekRoute(modelId: string, baseUrl = ''): boolean {
  const id = String(modelId || '')
  if (DEEPSEEK_MODEL_RE.test(id)) return true
  return /(nano-gpt\.com|127\.0\.0\.1:8791)/.test(String(baseUrl || ''))
}

export function isGlmRoute(modelId: string, baseUrl = ''): boolean {
  const id = String(modelId || '')
  if (GLM_MODEL_RE.test(id) || GLM_MODEL_RE.test(modelSlug(id))) return true
  return /bigmodel\.cn/.test(String(baseUrl || ''))
}

function applyGrok(body: Record<string, unknown>, maxMode: boolean, parameters: MapParam[]): void {
  const effort = param(parameters, 'effort')
  const fast = param(parameters, 'fast')
  if (maxMode === true) {
    body.reasoning_effort = 'xhigh'
    return
  }
  if (isTrue(fast)) {
    body.reasoning_effort = 'low'
    return
  }
  if (effort != null && Object.prototype.hasOwnProperty.call(EFFORT_TO_XAI, String(effort))) {
    body.reasoning_effort = EFFORT_TO_XAI[String(effort)]
  }
}

function applyGemini(body: Record<string, unknown>, parameters: MapParam[]): boolean {
  const m = String(body.model || '')
  if (!GEMINI_TIERED_FAMILY_RE.test(modelSlug(m))) return false
  const effort = param(parameters, 'effort')
  if (effort == null && param(parameters, 'fast') == null) return false
  if (isTrue(param(parameters, 'fast'))) return false
  const token = GEMINI_EFFORT_TO_SLUG[String(effort)]
  if (!token) return false
  body.model = `${m}-${token}`
  return true
}

function applyDeepSeek(body: Record<string, unknown>, modelId: string, parameters: MapParam[]): boolean {
  const slugThinking = /:thinking\s*$/i.test(String(modelId))
  const harnessThinking = param(parameters, 'thinking')
  const enable = slugThinking || isTrue(harnessThinking)
  if (!enable) return false
  body.thinking = { type: 'enabled' }
  if (body.reasoning_effort == null) body.reasoning_effort = 'high'
  if (body.max_tokens == null) body.max_tokens = 256000
  return true
}

function applyGlm(body: Record<string, unknown>, parameters: MapParam[]): string | null {
  const fast = param(parameters, 'fast')
  if (isTrue(fast)) {
    body.thinking = { type: 'disabled' }
    return 'glm-fast-off'
  }
  const effort = param(parameters, 'effort')
  const token = effort != null ? GLM_EFFORT[String(effort)] : undefined
  if (token) {
    if (!body.thinking) body.thinking = { type: 'enabled' }
    if (body.reasoning_effort == null) body.reasoning_effort = token
    return 'glm-effort'
  }
  const thinking = param(parameters, 'thinking')
  if (isFalse(thinking)) {
    body.thinking = { type: 'disabled' }
    return 'glm-thinking-off'
  }
  return null
}

/**
 * Mutates `body` for verified routes only. Returns the audit label applied.
 * Unknown / unverified -> "none" and the body is left untouched.
 */
export function applyProviderReasoningControls(
  body: Record<string, unknown>,
  ctx: ProviderMapContext = {},
): string {
  const modelId = String(ctx.modelId || body.model || '')
  const baseUrl = String(ctx.baseUrl || '')
  const parameters = controlsOf(ctx)
  if (isGrokRoute(modelId, baseUrl)) {
    applyGrok(body, ctx.maxMode === true, parameters)
    return 'grok'
  }
  if (isClaudeRoute(modelId, baseUrl)) {
    return 'claude-passthrough'
  }
  if (isGeminiRoute(modelId, baseUrl)) {
    return applyGemini(body, parameters) ? 'gemini-slug' : 'gemini-passthrough'
  }
  if (isDeepSeekRoute(modelId, baseUrl)) {
    return applyDeepSeek(body, modelId, parameters) ? 'deepseek-thinking' : 'deepseek-passthrough'
  }
  if (isGlmRoute(modelId, baseUrl)) {
    return applyGlm(body, parameters) || 'glm-passthrough'
  }
  return 'none'
}
