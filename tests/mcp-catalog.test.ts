import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  CURATED_CATALOG,
  SCHEMA_HINTS,
  callMcpTool,
  discoverTools,
  installMcp,
  listCatalog,
  listInstalled,
  mcpInstalledPath,
  mcpStatus,
  uninstallMcp,
  writeMcpSecret,
} from '../src/runtime/mcp-catalog'
import { knownConnectorId, writeConnectorSecret } from '../src/runtime/connectors'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  return home
}

describe('mcp catalog', () => {
  test('catalog has no empty fake names', () => {
    expect(CURATED_CATALOG.length).toBeGreaterThanOrEqual(3)
    for (const row of CURATED_CATALOG) {
      expect(row.id.trim().length).toBeGreaterThan(0)
      expect(row.name.trim().length).toBeGreaterThan(0)
      expect(row.description.trim().length).toBeGreaterThan(10)
      expect(typeof row.needsAuth).toBe('boolean')
      // Every curated id with schema hints must list real tool names
      const hints = SCHEMA_HINTS[row.id]
      expect(hints?.length ?? 0).toBeGreaterThan(0)
      for (const tool of hints ?? []) {
        expect(tool.name.trim().length).toBeGreaterThan(0)
      }
    }
    // No invented Cursor marketplace ids
    for (const row of CURATED_CATALOG) {
      expect(row.id).not.toMatch(/^cursor-/i)
      expect(row.package ?? '').not.toMatch(/cursor\.private/i)
    }
  })

  test('search filters by name / description / package', () => {
    const home = tmpHome()
    const all = listCatalog({ home })
    expect(all.length).toBe(CURATED_CATALOG.length)
    const gh = listCatalog({ query: 'github', home })
    expect(gh.some((row) => row.id === 'github')).toBe(true)
    expect(gh.every((row) => /github/i.test(row.id + row.name + row.description + (row.package ?? '')))).toBe(
      true,
    )
    const empty = listCatalog({ query: 'zzznomatch-invented-plugin', home })
    expect(empty).toEqual([])
    rmSync(home, { recursive: true, force: true })
  })

  test('install / uninstall persist under ~/.automaton/mcp/installed.json', () => {
    const home = tmpHome()
    expect(listInstalled(home)).toEqual([])
    const installed = installMcp('filesystem', home)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.value.status).toBe('installed')
    expect(mcpStatus('filesystem', home)?.id).toBe('filesystem')
    const path = mcpInstalledPath(home)
    expect(existsSync(path)).toBe(true)
    const disk = JSON.parse(readFileSync(path, 'utf8')) as Array<{ id: string }>
    expect(disk.some((row) => row.id === 'filesystem')).toBe(true)
    const listed = listCatalog({ home }).find((row) => row.id === 'filesystem')
    expect(listed?.status).toBe('installed')
    const gone = uninstallMcp('filesystem', home)
    expect(gone.ok).toBe(true)
    expect(mcpStatus('filesystem', home)).toBeNull()
    expect(listInstalled(home)).toEqual([])
    rmSync(home, { recursive: true, force: true })
  })

  test('unknown id fails with Need', () => {
    const home = tmpHome()
    const bad = installMcp('cursor-private-fake-marketplace', home)
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error).toMatch(/^Need:/)
    const missing = uninstallMcp('filesystem', home)
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.error).toMatch(/^Need:/)
    rmSync(home, { recursive: true, force: true })
  })

  test('discoverTools Need when not installed; hints after install', () => {
    const home = tmpHome()
    const before = discoverTools('github', home)
    expect(before.ok).toBe(false)
    if (before.ok) return
    expect(before.tools).toEqual([])
    expect(before.error).toMatch(/Need: install/)
    const installed = installMcp('github', home)
    expect(installed.ok).toBe(true)
    if (installed.ok) expect(installed.value.status).toBe('needsAuth')
    const after = discoverTools('github', home)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.source).toBe('schema-hint')
    expect(after.tools.some((row) => row.name === 'create_issue')).toBe(true)
    const stub = callMcpTool('github', 'create_issue', {}, home)
    expect(stub.ok).toBe(false) // needs auth grant
    if (stub.ok) return
    expect(stub.error).toMatch(/Need auth/)
    expect(writeMcpSecret('github', 'ghp_test_not_logged', home)).toBe(true)
    const stub2 = callMcpTool('github', 'create_issue', {}, home)
    expect(stub2.ok).toBe(true)
    if (!stub2.ok) return
    expect(stub2.value.stub).toBe(true)
    expect(stub2.value.message).toMatch(/not wired/)
    rmSync(home, { recursive: true, force: true })
  })


  test('MCP permit path records initiator and paints decide→act→done', () => {
    const home = tmpHome()
    installMcp('github', home)
    writeMcpSecret('github', 'ghp_test_not_logged', home)
    const events: { decision: string; initiatorKind: string; tool: string }[] = []
    const phases: string[] = []
    const stub = callMcpTool('github', 'create_issue', {}, home, {
      ownerAgentId: 'staff',
      initiatorKind: 'person',
      recordAction: (event) =>
        events.push({
          decision: event.decision,
          initiatorKind: event.initiatorKind,
          tool: event.tool,
        }),
      emitMouthStream: (step) => phases.push(step.phase),
    })
    expect(stub.ok).toBe(true)
    expect(events).toEqual([{ decision: 'permit', initiatorKind: 'person', tool: 'mcp:github' }])
    expect(phases).toEqual(['decide', 'act', 'done'])
    rmSync(home, { recursive: true, force: true })
  })

  test('MCP auth refuse records refuse initiator webhook', () => {
    const home = tmpHome()
    installMcp('github', home)
    const events: { decision: string; reason: string; initiatorKind: string }[] = []
    const phases: string[] = []
    const stub = callMcpTool('github', 'create_issue', {}, home, {
      ownerAgentId: 'staff',
      initiatorKind: 'webhook',
      recordAction: (event) =>
        events.push({
          decision: event.decision,
          reason: event.reason,
          initiatorKind: event.initiatorKind,
        }),
      emitMouthStream: (step) => phases.push(step.phase),
    })
    expect(stub.ok).toBe(false)
    expect(events[0]).toEqual({ decision: 'refuse', reason: 'mcp_auth', initiatorKind: 'webhook' })
    expect(phases).toEqual(['decide', 'refuse'])
    rmSync(home, { recursive: true, force: true })
  })

  test('needsAuth Connect reuses writeConnectorSecret / knownConnectorId', () => {
    const home = tmpHome()
    expect(knownConnectorId('github', home)).toBe(false)
    installMcp('github', home)
    expect(knownConnectorId('github', home)).toBe(true)
    expect(writeConnectorSecret('github', 'ghp_via_connector_path', home)).toBe(true)
    expect(mcpStatus('github', home)?.status).toBe('installed')
    expect(listCatalog({ home }).find((row) => row.id === 'github')?.status).toBe('installed')
    rmSync(home, { recursive: true, force: true })
  })
})
