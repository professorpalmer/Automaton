import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { automatonHome } from './keys'

/** Curated installable MCP connector (honest rows only — never invent marketplace IDs). */
export type CatalogEntry = {
  id: string
  name: string
  description: string
  package?: string
  homepage?: string
  needsAuth: boolean
}

export type InstalledMcpStatus = 'installed' | 'needsAuth' | 'error'

export type InstalledMcp = {
  id: string
  installedAt: string
  status: InstalledMcpStatus
  lastError?: string
}

/** Browse/search chip: available until installed; then mirrors InstalledMcp (+ auth). */
export type CatalogEntryStatus = 'available' | 'installed' | 'needsAuth' | 'error'

export type McpToolHint = {
  name: string
  description?: string
}

export type DiscoverToolsResult =
  | { ok: true; tools: McpToolHint[]; source: 'schema-hint' }
  | { ok: false; tools: []; error: string }

export type McpOpResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { value: T }))
  | { ok: false; error: string }

/**
 * Small honest catalog. Packages map to real published servers / docs.
 * Do not invent Cursor private marketplace IDs. OpenRouter stays in Connectors
 * (HTTP mouth provider), not here — see docs/mcp.md.
 */
export const CURATED_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description:
      'GitHub API via MCP (issues, PRs, repos, search). npm @modelcontextprotocol/server-github is deprecated; prefer ghcr.io/github/github-mcp-server. Needs a personal access token.',
    package: '@modelcontextprotocol/server-github',
    homepage: 'https://github.com/github/github-mcp-server',
    needsAuth: true,
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description:
      'Secure local file ops (read/write/list/search) within allowed directories. Package @modelcontextprotocol/server-filesystem.',
    package: '@modelcontextprotocol/server-filesystem',
    homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
    needsAuth: false,
  },
  {
    id: 'puppetmaster',
    name: 'Puppetmaster',
    description:
      'Durable job supervisor MCP from puppetmaster-ai (`python -m puppetmaster.mcp_server`). Doctor, review/plan/implement starts, status/logs, CodeGraph helpers.',
    package: 'puppetmaster-ai',
    homepage: 'https://github.com/professorpalmer/Puppetmaster/blob/main/docs/CURSOR_AGENT_MCP.md',
    needsAuth: false,
  },
  {
    id: 'memory',
    name: 'Memory',
    description:
      'Knowledge-graph memory server for persistent notes across sessions. Package @modelcontextprotocol/server-memory.',
    package: '@modelcontextprotocol/server-memory',
    homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-memory',
    needsAuth: false,
  },
] as const

/**
 * Declared tool names from published docs — honest schema hints until a live
 * MCP client exists. Not live probes; callMcpTool remains a documented stub.
 */
export const SCHEMA_HINTS: Readonly<Record<string, readonly McpToolHint[]>> = {
  github: [
    { name: 'create_or_update_file', description: 'Create or update a file in a repository' },
    { name: 'push_files', description: 'Push multiple files in a single commit' },
    { name: 'search_repositories', description: 'Search GitHub repositories' },
    { name: 'create_repository', description: 'Create a new repository' },
    { name: 'get_file_contents', description: 'Read file contents from a repository' },
    { name: 'create_issue', description: 'Create an issue' },
    { name: 'create_pull_request', description: 'Open a pull request' },
    { name: 'list_issues', description: 'List and filter issues' },
    { name: 'search_code', description: 'Search code across GitHub' },
    { name: 'get_pull_request', description: 'Get pull request details' },
    { name: 'list_pull_requests', description: 'List pull requests' },
  ],
  filesystem: [
    { name: 'read_text_file', description: 'Read a text file within allowed directories' },
    { name: 'read_media_file', description: 'Read image/audio as base64' },
    { name: 'read_multiple_files', description: 'Read several files at once' },
    { name: 'write_file', description: 'Create or overwrite a file' },
    { name: 'edit_file', description: 'Apply selective edits' },
    { name: 'create_directory', description: 'Create a directory' },
    { name: 'list_directory', description: 'List directory entries' },
    { name: 'directory_tree', description: 'Recursive directory tree' },
    { name: 'move_file', description: 'Move or rename a file' },
    { name: 'search_files', description: 'Search by glob pattern' },
    { name: 'get_file_info', description: 'File metadata' },
    { name: 'list_allowed_directories', description: 'List allowed roots' },
  ],
  puppetmaster: [
    { name: 'puppetmaster_doctor', description: 'Runtime / SQLite / adapter health' },
    { name: 'puppetmaster_start_cursor_review', description: 'Start a Cursor review job' },
    { name: 'puppetmaster_start_cursor_plan', description: 'Start a Cursor plan job' },
    { name: 'puppetmaster_start_claude_implement', description: 'Start Claude Code implement' },
    { name: 'puppetmaster_start_swarm', description: 'Start a multi-role swarm' },
    { name: 'puppetmaster_status', description: 'Job status / counts' },
    { name: 'puppetmaster_logs', description: 'Job event stream' },
    { name: 'puppetmaster_show', description: 'Stitched summary' },
    { name: 'puppetmaster_dashboard', description: 'Ensure local dashboard URL' },
    { name: 'puppetmaster_codegraph_search', description: 'CodeGraph query' },
    { name: 'puppetmaster_codegraph_context', description: 'CodeGraph context' },
    { name: 'puppetmaster_last_job', description: 'Most recent job' },
  ],
  memory: [
    { name: 'create_entities', description: 'Create entities in the knowledge graph' },
    { name: 'create_relations', description: 'Create relations between entities' },
    { name: 'add_observations', description: 'Add observations to entities' },
    { name: 'delete_entities', description: 'Delete entities' },
    { name: 'delete_observations', description: 'Delete observations' },
    { name: 'delete_relations', description: 'Delete relations' },
    { name: 'read_graph', description: 'Read the full knowledge graph' },
    { name: 'search_nodes', description: 'Search nodes' },
    { name: 'open_nodes', description: 'Open nodes by name' },
  ],
}

export function mcpRoot(home = automatonHome()): string {
  return join(home, 'mcp')
}

export function mcpInstalledPath(home = automatonHome()): string {
  return join(mcpRoot(home), 'installed.json')
}

export function mcpSecretsDir(home = automatonHome()): string {
  return join(mcpRoot(home), 'secrets')
}

export function mcpSecretPath(id: string, home = automatonHome()): string {
  return join(mcpSecretsDir(home), `${id.trim()}.json`)
}

function asError(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asStatus(value: unknown): InstalledMcpStatus {
  if (value === 'needsAuth' || value === 'error' || value === 'installed') return value
  return 'installed'
}

function normalizeInstalled(row: Record<string, unknown>): InstalledMcp | null {
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : ''
  if (!id) return null
  const installedAt =
    typeof row.installedAt === 'string' && row.installedAt.trim()
      ? row.installedAt.trim()
      : new Date().toISOString()
  return {
    id,
    installedAt,
    status: asStatus(row.status),
    lastError: asError(row.lastError),
  }
}

function readInstalledFile(home = automatonHome()): InstalledMcp[] {
  const path = mcpInstalledPath(home)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((row) => row && typeof row === 'object')
      .map((row) => normalizeInstalled(row as Record<string, unknown>))
      .filter((row): row is InstalledMcp => row != null)
  } catch {
    return []
  }
}

function writeInstalledFile(rows: InstalledMcp[], home = automatonHome()): void {
  const path = mcpInstalledPath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
}

export function catalogEntry(id: string): CatalogEntry | undefined {
  const trimmed = id.trim()
  return CURATED_CATALOG.find((row) => row.id === trimmed)
}

export function listCatalog(opts?: { query?: string; home?: string }): Array<
  CatalogEntry & { status: CatalogEntryStatus }
> {
  const home = opts?.home ?? automatonHome()
  const q = (opts?.query ?? '').trim().toLowerCase()
  const installed = readInstalledFile(home)
  const byId = new Map(installed.map((row) => [row.id, row]))
  let rows = CURATED_CATALOG.map((entry) => {
    const hit = byId.get(entry.id)
    let status: CatalogEntryStatus = 'available'
    if (hit) {
      if (hit.status === 'error') status = 'error'
      else if (hit.status === 'needsAuth') status = 'needsAuth'
      else status = 'installed'
    }
    return { ...entry, status }
  })
  if (q) {
    rows = rows.filter(
      (row) =>
        row.id.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        (row.package?.toLowerCase().includes(q) ?? false),
    )
  }
  return rows
}

export function listInstalled(home = automatonHome()): InstalledMcp[] {
  return readInstalledFile(home)
}

export function mcpStatus(id: string, home = automatonHome()): InstalledMcp | null {
  const trimmed = id.trim()
  if (!trimmed) return null
  return readInstalledFile(home).find((row) => row.id === trimmed) ?? null
}

export function installMcp(
  id: string,
  home = automatonHome(),
  now = () => new Date().toISOString(),
): McpOpResult<InstalledMcp> {
  const entry = catalogEntry(id)
  if (!entry) {
    return { ok: false, error: `Need: unknown MCP catalog id ${id.trim() || '(empty)'}.` }
  }
  const rows = readInstalledFile(home)
  const existing = rows.find((row) => row.id === entry.id)
  if (existing && existing.status !== 'error') {
    return { ok: true, value: existing }
  }
  const next: InstalledMcp = {
    id: entry.id,
    installedAt: now(),
    status: entry.needsAuth ? 'needsAuth' : 'installed',
  }
  const without = rows.filter((row) => row.id !== entry.id)
  writeInstalledFile([...without, next], home)
  return { ok: true, value: next }
}

export function uninstallMcp(id: string, home = automatonHome()): McpOpResult {
  const trimmed = id.trim()
  if (!trimmed) return { ok: false, error: 'Need an MCP id to uninstall.' }
  const rows = readInstalledFile(home)
  if (!rows.some((row) => row.id === trimmed)) {
    return { ok: false, error: `Need: ${trimmed} is not installed.` }
  }
  writeInstalledFile(
    rows.filter((row) => row.id !== trimmed),
    home,
  )
  const secret = mcpSecretPath(trimmed, home)
  if (existsSync(secret)) {
    try {
      writeFileSync(secret, '{}\n', { mode: 0o600 })
    } catch {
      /* best-effort clear */
    }
  }
  return { ok: true }
}

export function markMcpError(id: string, error: string, home = automatonHome()): InstalledMcp | null {
  const trimmed = id.trim()
  const rows = readInstalledFile(home)
  const hit = rows.find((row) => row.id === trimmed)
  if (!hit) return null
  const next: InstalledMcp = {
    ...hit,
    status: 'error',
    lastError: error.trim() || 'Need: install failed.',
  }
  writeInstalledFile(
    rows.map((row) => (row.id === trimmed ? next : row)),
    home,
  )
  return next
}

/** True when id is an installed MCP that accepts a secret-request / Connect grant. */
export function mcpAcceptsSecret(id: string, home = automatonHome()): boolean {
  const entry = catalogEntry(id)
  if (!entry?.needsAuth) return false
  return mcpStatus(id, home) != null
}

export function mcpDisplayName(id: string): string {
  return catalogEntry(id)?.name ?? id
}

/**
 * Write-only MCP secret. Callers must not log `value` or put it on a feed item.
 * Used by writeConnectorSecret when the id is an installed auth MCP.
 */
export function writeMcpSecret(id: string, value: string, home = automatonHome()): boolean {
  const trimmed = id.trim()
  const secret = value.trim()
  if (!trimmed || !secret) return false
  if (!mcpAcceptsSecret(trimmed, home)) return false
  const path = mcpSecretPath(trimmed, home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ configured: true }, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
  // Store the grant separately so configured:true never sits next to raw secret in one parse path that logs.
  const grantPath = join(mcpSecretsDir(home), `${trimmed}.grant`)
  writeFileSync(grantPath, `${secret}\n`, { mode: 0o600 })
  try {
    chmodSync(grantPath, 0o600)
  } catch {
    /* best-effort */
  }
  const rows = readInstalledFile(home)
  writeInstalledFile(
    rows.map((row) =>
      row.id === trimmed
        ? { ...row, status: 'installed' as const, lastError: undefined }
        : row,
    ),
    home,
  )
  return true
}

export function hasMcpGrant(id: string, home = automatonHome()): boolean {
  const trimmed = id.trim()
  if (!trimmed) return false
  const grantPath = join(mcpSecretsDir(home), `${trimmed}.grant`)
  if (!existsSync(grantPath)) return false
  try {
    return readFileSync(grantPath, 'utf8').trim().length > 0
  } catch {
    return false
  }
}

/** Alias used by CoS call-path wording. */
export function discoverSchemas(id: string, home = automatonHome()): DiscoverToolsResult {
  return discoverTools(id, home)
}

export function discoverTools(id: string, home = automatonHome()): DiscoverToolsResult {
  const trimmed = id.trim()
  if (!trimmed) {
    return { ok: false, tools: [], error: 'Need an MCP id.' }
  }
  if (!catalogEntry(trimmed)) {
    return { ok: false, tools: [], error: `Need: unknown MCP catalog id ${trimmed}.` }
  }
  if (!mcpStatus(trimmed, home)) {
    return { ok: false, tools: [], error: `Need: install ${trimmed} before discovering tools.` }
  }
  const hints = SCHEMA_HINTS[trimmed]
  if (!hints || hints.length === 0) {
    return {
      ok: false,
      tools: [],
      error: `Need: no schema hint for ${trimmed} yet (live MCP client not wired).`,
    }
  }
  return { ok: true, tools: [...hints], source: 'schema-hint' }
}

/**
 * Live MCP call stub — registry + schema hints only in MVP.
 * Never scrapes cookies or invents a transport.
 */
export function callMcpTool(
  id: string,
  toolName: string,
  _args?: Record<string, unknown>,
  home = automatonHome(),
): McpOpResult<{ stub: true; message: string }> {
  const trimmed = id.trim()
  const tool = toolName.trim()
  if (!trimmed || !tool) {
    return { ok: false, error: 'Need MCP id and tool name.' }
  }
  const discovered = discoverTools(trimmed, home)
  if (!discovered.ok) return { ok: false, error: discovered.error }
  if (!discovered.tools.some((row) => row.name === tool)) {
    return { ok: false, error: `Need: tool ${tool} not in schema hint for ${trimmed}.` }
  }
  if (catalogEntry(trimmed)?.needsAuth && !hasMcpGrant(trimmed, home)) {
    return { ok: false, error: `Need auth for ${trimmed}.` }
  }
  return {
    ok: true,
    value: {
      stub: true,
      message:
        'MCP live call not wired in Automaton 0.8.0 — discoverTools/schema hints only. See docs/mcp.md.',
    },
  }
}

export function mcpStatusLabel(status: CatalogEntryStatus): string {
  switch (status) {
    case 'available':
      return 'Available'
    case 'installed':
      return 'Installed'
    case 'needsAuth':
      return 'Need auth'
    case 'error':
      return 'Error'
  }
}
