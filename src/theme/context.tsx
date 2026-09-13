import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { readSkin, type Skin } from '../runtime/skin'
import { tokensFromSkin } from './resolve'
import { DEFAULT_TOKENS, type Tokens } from './tokens'

export type TokenEnv = {
  tokens: Tokens
  replace: (next: Tokens) => void
  refresh: () => void
}

const TokenContext = createContext<TokenEnv | null>(null)

export function TokenProvider({
  children,
  skin,
}: {
  children: React.ReactNode
  skin?: Skin
}) {
  const [tokens, setTokens] = useState<Tokens>(() => tokensFromSkin(skin ?? readSkin()))
  const replace = useCallback((next: Tokens) => {
    setTokens(next)
  }, [])
  const refresh = useCallback(() => {
    setTokens(tokensFromSkin(readSkin()))
  }, [])
  const value = useMemo<TokenEnv>(() => ({ tokens, replace, refresh }), [tokens, replace, refresh])
  return <TokenContext.Provider value={value}>{children}</TokenContext.Provider>
}

export function useTokenEnv(): TokenEnv {
  return (
    useContext(TokenContext) ?? {
      tokens: DEFAULT_TOKENS,
      replace: () => {},
      refresh: () => {},
    }
  )
}

/** Paint reads tokens from the environment. Falls back to the frozen default snapshot. */
export function useTokens(): Tokens {
  return useTokenEnv().tokens
}
