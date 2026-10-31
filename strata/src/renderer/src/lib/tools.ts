import { basename, relative } from './path'

export interface ToolSummary {
  verb: string
  target: string
  path?: string
  kind: 'read' | 'edit' | 'run' | 'search' | 'web' | 'agent' | 'plan' | 'other'
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

/** Short human description of a tool call: "Edit  src/shop/SwordShop.lua". */
export function summarizeTool(name: string, input: Record<string, unknown>, root: string): ToolSummary {
  const filePath = str(input.file_path ?? input.notebook_path ?? input.path)
  const rel = filePath ? relative(root, filePath) : ''
  switch (name) {
    case 'Read':
      return { verb: 'Read', target: rel || basename(filePath), path: filePath, kind: 'read' }
    case 'NotebookRead':
      return { verb: 'Read notebook', target: rel, path: filePath, kind: 'read' }
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'Edit', target: rel, path: filePath, kind: 'edit' }
    case 'Write':
      return { verb: 'Write', target: rel, path: filePath, kind: 'edit' }
    case 'NotebookEdit':
      return { verb: 'Edit notebook', target: rel, path: filePath, kind: 'edit' }
    case 'Bash':
      return { verb: 'Run', target: str(input.command), kind: 'run' }
    case 'BashOutput':
      return { verb: 'Read output', target: str(input.bash_id), kind: 'run' }
    case 'KillShell':
    case 'KillBash':
      return { verb: 'Stop shell', target: str(input.shell_id ?? input.bash_id), kind: 'run' }
    case 'Grep':
      return { verb: 'Search', target: `${str(input.pattern)}${input.path ? ' in ' + relative(root, str(input.path)) : ''}`, kind: 'search' }
    case 'Glob':
      return { verb: 'Find files', target: str(input.pattern), kind: 'search' }
    case 'LS':
      return { verb: 'List', target: rel || '.', path: filePath, kind: 'read' }
    case 'WebFetch':
      return { verb: 'Fetch', target: str(input.url), kind: 'web' }
    case 'WebSearch':
      return { verb: 'Search web', target: str(input.query), kind: 'web' }
    case 'Task':
    case 'Agent':
      return { verb: 'Agent', target: str(input.description ?? input.subagent_type), kind: 'agent' }
    case 'TodoWrite':
      return { verb: 'Update plan', target: '', kind: 'plan' }
    case 'ExitPlanMode':
      return { verb: 'Plan ready', target: '', kind: 'plan' }
    default: {
      const mcp = name.match(/^mcp__([^_]+)__(.+)$/)
      if (mcp) return { verb: mcp[2].replace(/_/g, ' '), target: mcp[1], kind: 'other' }
      return { verb: name, target: rel, path: filePath || undefined, kind: 'other' }
    }
  }
}

/** One-line description for permission cards. */
export function describePermission(name: string, input: Record<string, unknown>, root: string): { title: string; detail?: string; code?: string } {
  const s = summarizeTool(name, input, root)
  switch (name) {
    case 'Bash':
      return { title: 'Run a command', detail: str(input.description) || undefined, code: str(input.command) }
    case 'Edit':
    case 'MultiEdit':
      return { title: `Edit ${s.target}` }
    case 'Write':
      return { title: `Write ${s.target}` }
    case 'WebFetch':
      return { title: 'Fetch a web page', code: str(input.url) }
    case 'WebSearch':
      return { title: 'Search the web', code: str(input.query) }
    case 'ExitPlanMode':
      return { title: 'Approve the plan and start working', detail: str(input.plan) }
    default:
      return { title: `Use ${s.verb}${s.target ? ' · ' + s.target : ''}`, code: Object.keys(input).length ? JSON.stringify(input, null, 2).slice(0, 1200) : undefined }
  }
}

export function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}
