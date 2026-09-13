import { DEFAULT_TOKENS, type Tokens } from './tokens'

/** gpuix Chat/Input `theme={…}` shape. Built from the live token snapshot. */
export type GpuixTextTheme = {
  text: string
  textMuted: string
  textFaint: string
  textDim: string
  border: string
  bg: string
  accent: string
  caret: string
  fontSans: string
  codeText: string
  codeWash: string
  metrics: {
    mdTextSize: number
    mdLineHeight: number
    mdBlockGap: number
    mdHeadingSizes: number[]
    mdHeadingLineHeights: number[]
    codeTextSize: number
    codeLineHeight: number
    codeRadius: number
    codeHeaderTextSize: number
    diffLineHeight: number
    diffFileHeaderHeight: number
  }
}

export function toChatTheme(tokens: Tokens): GpuixTextTheme {
  return {
    text: tokens.text,
    textMuted: tokens.text,
    textFaint: tokens.text,
    textDim: tokens.text,
    border: tokens.clear,
    bg: tokens.clear,
    accent: tokens.accent,
    caret: tokens.accent,
    fontSans: 'Helvetica',
    codeText: tokens.text,
    codeWash: tokens.overlay,
    metrics: {
      mdTextSize: tokens.type.md,
      mdLineHeight: tokens.line.lg,
      mdBlockGap: tokens.space.lg,
      mdHeadingSizes: [tokens.type.xl, tokens.type.lg, tokens.type.md, tokens.type.md],
      mdHeadingLineHeights: [tokens.line.xl, tokens.line.lg, 22, 22],
      codeTextSize: 12.5,
      codeLineHeight: tokens.line.md,
      codeRadius: tokens.radius.md,
      codeHeaderTextSize: tokens.type.sm,
      diffLineHeight: tokens.line.md,
      diffFileHeaderHeight: 34,
    },
  }
}

/** Inputs on frost. Native placeholders read textMuted, so it matches body type. */
export function toFieldTheme(tokens: Tokens): GpuixTextTheme {
  return {
    ...toChatTheme(tokens),
    text: tokens.text,
    textMuted: tokens.text,
    textFaint: tokens.text,
    textDim: tokens.text,
  }
}

export const CHAT_THEME = toChatTheme(DEFAULT_TOKENS)
export const FIELD_THEME = toFieldTheme(DEFAULT_TOKENS)
