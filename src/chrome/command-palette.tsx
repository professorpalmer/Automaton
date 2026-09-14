import React, { useEffect, useMemo, useState } from 'react'
import { toFieldTheme, useTokens } from '../theme'
import { menuItemStyle } from '../ui'
import { groupBoxStyle, menuFill } from './surface'
import {
  buildPaletteItems,
  filterPaletteItems,
  groupPaletteItems,
  type PaletteItem,
} from './palette'

const HIT = {
  cursor: 'pointer' as const,
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
}

export type CommandPaletteProps = {
  open: boolean
  agents?: readonly { id: string; name: string; title?: string; hidden?: boolean }[]
  rooms?: readonly { id: string; name: string; archived?: boolean }[]
  onClose: () => void
  onSelectSister: (agentId: string) => void
  onSelectRoom: (roomId: string) => void
  onOpenSettings: (section?: string) => void
  onOpenJobs: () => void
}

/** Cmd+K overlay — field keeps focus; Esc clears then closes; opaque menu fill. */
export function CommandPalette({
  open,
  agents = [],
  rooms = [],
  onClose,
  onSelectSister,
  onSelectRoom,
  onOpenSettings,
  onOpenJobs,
}: CommandPaletteProps) {
  const T = useTokens()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHighlight(0)
    }
  }, [open])

  const catalog = useMemo(() => buildPaletteItems({ agents, rooms }), [agents, rooms])
  const picks = useMemo(() => filterPaletteItems(catalog, query), [catalog, query])
  const groups = useMemo(() => groupPaletteItems(picks), [picks])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  if (!open) return null

  const flat = picks
  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    if (item.section === 'Sisters' && item.targetId) onSelectSister(item.targetId)
    else if (item.section === 'Rooms' && item.targetId) onSelectRoom(item.targetId)
    else if (item.section === 'Settings') onOpenSettings(item.settingsSection)
    else if (item.section === 'Jobs') onOpenJobs()
    onClose()
  }

  return (
    <div
      testId="command-palette"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: T.space.hero,
        backgroundColor: 'rgba(0,0,0,0.28)',
        pointerEvents: 'auto',
      }}
      onClick={() => onClose()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Esc') {
          if (query.length > 0) {
            setQuery('')
            setHighlight(0)
            return
          }
          onClose()
        }
      }}
    >
      <div
        testId="command-palette-card"
        style={{
          ...groupBoxStyle(T, 'menu'),
          backgroundColor: menuFill(T),
          width: '100%',
          maxWidth: 480,
          maxHeight: '70%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
        onClick={(event) => {
          event.stopPropagation?.()
        }}
      >
        <input
          testId="command-palette-input"
          value={query}
          placeholder="Jump to sister, room, settings, Jobs…"
          autoFocus
          theme={toFieldTheme(T)}
          style={{
            width: '100%',
            fontSize: T.type.md,
            lineHeight: T.line.md,
            color: T.text,
            backgroundColor: T.clear,
            borderWidth: 0,
            borderColor: T.clear,
            paddingLeft: T.space.lg,
            paddingRight: T.space.lg,
            paddingTop: T.space.md,
            paddingBottom: T.space.md,
            borderBottomWidth: T.stroke.hairline,
            borderBottomColor: T.border,
          }}
          onChange={(event) => setQuery(event.value ?? '')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Down') {
              if (flat.length === 0) return
              setHighlight((n) => (n + 1) % flat.length)
              return
            }
            if (event.key === 'ArrowUp' || event.key === 'Up') {
              if (flat.length === 0) return
              setHighlight((n) => (n - 1 + flat.length) % flat.length)
              return
            }
            if (event.key === 'Enter') {
              run(flat[highlight])
              return
            }
            if (event.key === 'Escape' || event.key === 'Esc') {
              if (query.length > 0) {
                setQuery('')
                setHighlight(0)
                return
              }
              onClose()
            }
          }}
        />
        <div
          testId="command-palette-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'scroll',
            minHeight: 0,
            flexGrow: 1,
            paddingBottom: T.space.sm,
          }}
        >
          {flat.length === 0 ? (
            <div
              testId="command-palette-empty"
              style={{
                padding: T.space.lg,
                fontSize: T.type.sm,
                color: T.tertiary,
              }}
            >
              No matches.
            </div>
          ) : (
            groups.map((group) => {
              let offset = 0
              for (const prior of groups) {
                if (prior.section === group.section) break
                offset += prior.items.length
              }
              return (
                <div key={group.section} testId={`command-palette-section-${group.section}`}>
                  <div
                    style={{
                      paddingLeft: T.space.lg,
                      paddingRight: T.space.lg,
                      paddingTop: T.space.sm,
                      paddingBottom: T.space.xxs,
                      fontSize: T.type.xs,
                      color: T.ghost,
                    }}
                  >
                    {group.section}
                  </div>
                  {group.items.map((item, index) => {
                    const flatIndex = offset + index
                    const on = flatIndex === highlight
                    return (
                      <div
                        key={item.id}
                        testId={`command-palette-item-${item.id}`}
                        style={{
                          ...menuItemStyle({ highlighted: on }, T),
                          ...HIT,
                          display: 'flex',
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          gap: T.space.md,
                          paddingLeft: T.space.lg,
                          paddingRight: T.space.lg,
                        }}
                        onClick={() => run(item)}
                        onMouseEnter={() => setHighlight(flatIndex)}
                      >
                        <div style={{ fontSize: T.type.sm, color: T.text, minWidth: 0 }}>{item.label}</div>
                        {item.hint ? (
                          <div style={{ fontSize: T.type.xs, color: T.tertiary, flexShrink: 0 }}>{item.hint}</div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
