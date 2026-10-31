import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { McpServerInfo } from '@shared/types'
import { normalizeForCompare } from './paths'

type RawServer = Record<string, unknown>
interface Found extends McpServerInfo {
  raw: RawServer
}

function readJson(path: string): any | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}

/** ~/.claude.json (user + per-project "local" scope) — lives next to the config dir. */
function userConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
}

function describe(raw: RawServer): { type: McpServerInfo['type']; summary: string } {
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (url) {
    // Never show query strings: they often carry tokens.
    return { type: raw.type === 'sse' ? 'sse' : 'http', summary: url.split('?')[0] }
  }
  const args = Array.isArray(raw.args) ? (raw.args as unknown[]).map(String).join(' ') : ''
  return { type: 'stdio', summary: `${String(raw.command ?? '')} ${args}`.trim().slice(0, 120) }
}

function collect(out: Map<string, Found>, servers: unknown, source: McpServerInfo['source']): void {
  if (!servers || typeof servers !== 'object') return
  for (const [name, raw] of Object.entries(servers as Record<string, RawServer>)) {
    if (!raw || typeof raw !== 'object') continue
    // Later scopes win, same precedence as Claude Code: local > project > user.
    out.set(name, { name, source, ...describe(raw), raw })
  }
}

function discover(cwd: string): Map<string, Found> {
  const out = new Map<string, Found>()
  const user = readJson(userConfigPath())
  collect(out, user?.mcpServers, 'user')
  collect(out, readJson(join(cwd, '.mcp.json'))?.mcpServers, 'project')
  if (user?.projects && typeof user.projects === 'object') {
    const key = normalizeForCompare(cwd)
    for (const [p, cfg] of Object.entries(user.projects as Record<string, any>)) {
      if (normalizeForCompare(p) === key) collect(out, cfg?.mcpServers, 'local')
    }
  }
  return out
}

/** MCP servers Claude Code would load for this folder (secrets are not exposed). */
export function listMcpServers(cwd: string): McpServerInfo[] {
  return [...discover(resolve(cwd)).values()].map(({ raw: _raw, ...info }) => info).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * When the user switched servers off for a project, writes a config file with
 * only the remaining servers and returns its path for `--strict-mcp-config`.
 * Returns null when nothing is disabled, so Claude Code loads everything as usual.
 */
export function writeMcpConfig(projectId: string, cwd: string, disabled: string[]): string | null {
  if (!disabled.length) return null
  const off = new Set(disabled)
  const mcpServers: Record<string, RawServer> = {}
  for (const [name, found] of discover(resolve(cwd))) if (!off.has(name)) mcpServers[name] = found.raw
  const dir = join(app.getPath('userData'), 'mcp')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${projectId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`)
  // The file can contain tokens copied from the user's own MCP config: keep it private.
  writeFileSync(file, JSON.stringify({ mcpServers }, null, 2), { encoding: 'utf8', mode: 0o600 })
  return file
}
