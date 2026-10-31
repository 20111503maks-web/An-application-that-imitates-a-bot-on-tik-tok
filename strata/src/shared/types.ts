// Types shared between the main process, preload and renderer.

export type PermissionMode = 'ask' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/** Passed to Claude Code as --effort. Empty string = Claude Code's own default. */
export type EffortLevel = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORT_LEVELS: EffortLevel[] = ['', 'low', 'medium', 'high', 'xhigh', 'max']

export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
  lastOpenedAt: number
  /** Claude Code session the project's chat is attached to. */
  sessionId?: string
  /** Tool permission rules the user granted "always" for this project. */
  allowedTools?: string[]
  pinned?: boolean
  /** Names of MCP servers switched off for this project only. */
  disabledMcp?: string[]
}

export type ThemeName = 'dark' | 'midnight' | 'light'

export interface Settings {
  claudePath: string
  blenderPath: string
  robloxStudioPath: string
  rojoPath: string
  gitPath: string
  shell: string
  model: string
  effort: EffortLevel
  permissionMode: PermissionMode
  streamPartialMessages: boolean
  theme: ThemeName
  accent: string
  uiScale: number
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  editorTabSize: number
  terminalFontSize: number
  restoreLastProject: boolean
  confirmRemoveProject: boolean
  gitAutoRefresh: boolean
  lastProjectId?: string
  onboarded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  claudePath: '',
  blenderPath: '',
  robloxStudioPath: '',
  rojoPath: '',
  gitPath: '',
  shell: '',
  model: '',
  effort: '',
  permissionMode: 'acceptEdits',
  streamPartialMessages: true,
  theme: 'dark',
  accent: '#d97757',
  uiScale: 1,
  editorFontSize: 13,
  editorWordWrap: false,
  editorMinimap: true,
  editorTabSize: 2,
  terminalFontSize: 13,
  restoreLastProject: true,
  confirmRemoveProject: true,
  gitAutoRefresh: true,
  onboarded: false
}

// ---------------------------------------------------------------- tools

export type ToolId = 'claude' | 'blender' | 'roblox' | 'rojo' | 'git' | 'node' | 'python'

export interface ToolInfo {
  id: ToolId
  name: string
  found: boolean
  path?: string
  version?: string
  error?: string
}

export interface ClaudeAuth {
  checked: boolean
  loggedIn: boolean | null
  method?: string
  provider?: string
  error?: string
}

export interface McpServerInfo {
  name: string
  source: 'user' | 'project' | 'local'
  type: 'stdio' | 'http' | 'sse'
  /** Command line or URL (without query string) — never includes secrets. */
  summary: string
}

export interface McpServerStatus {
  name: string
  status: string
}

export interface ToolsReport {
  tools: Record<ToolId, ToolInfo>
  claudeAuth: ClaudeAuth
  shells: { id: string; label: string; path: string }[]
  detectedAt: number
}

// ---------------------------------------------------------------- project info

export type ProjectKind =
  | 'roblox'
  | 'rojo'
  | 'blender'
  | 'node'
  | 'python'
  | 'csharp'
  | 'unity'
  | 'web'
  | 'rust'
  | 'go'
  | 'lua'
  | 'git'

export interface ProjectInfo {
  path: string
  kinds: ProjectKind[]
  label: string
  blendFiles: string[]
  placeFiles: string[]
  rojoProjects: string[]
  isGit: boolean
  exists: boolean
}

// ---------------------------------------------------------------- filesystem

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  isSymlink?: boolean
}

export interface FileContent {
  path: string
  content: string
  binary: boolean
  tooLarge: boolean
  size: number
  mtime: number
}

// ---------------------------------------------------------------- git

export interface GitFile {
  path: string
  /** Index (staged) status letter, ' ' if none. */
  index: string
  /** Working tree status letter, ' ' if none. */
  work: string
  origPath?: string
}

export interface GitStatus {
  isRepo: boolean
  /** Repository top-level folder; file paths are relative to it. */
  root?: string
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFile[]
  error?: string
}

// ---------------------------------------------------------------- claude

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description?: string
}

export interface PendingChange {
  path: string
  /** Original content before Claude touched it; null if Claude created the file. */
  original: string | null
  createdAt: number
  additions: number
  deletions: number
  deleted: boolean
}

/** Normalised events emitted by the Claude process manager to the renderer. */
export type ClaudeEvent =
  | { kind: 'status'; state: 'starting' | 'ready' | 'busy' | 'idle' | 'stopped' }
  | { kind: 'session'; sessionId: string; model?: string; cwd?: string; tools?: string[]; mcp?: McpServerStatus[] }
  | { kind: 'usage'; contextTokens: number }
  | { kind: 'text-delta'; messageId: string; text: string }
  | { kind: 'thinking-delta'; messageId: string; text: string }
  | { kind: 'assistant-text'; messageId: string; blockIndex: number; text: string }
  | { kind: 'thinking'; messageId: string; blockIndex: number; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'permission-resolved'; requestId: string; allowed: boolean }
  | { kind: 'summary'; text: string }
  | { kind: 'changes'; changes: PendingChange[] }
  | {
      kind: 'result'
      success: boolean
      text?: string
      costUsd?: number
      durationMs?: number
      numTurns?: number
      contextWindow?: number
      error?: string
      denials: { toolName: string; input: Record<string, unknown> }[]
      changedFiles: string[]
    }
  | { kind: 'auth-required'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: number | null }

export interface ClaudeEventEnvelope {
  projectId: string
  event: ClaudeEvent
}

export interface ClaudeLogLine {
  projectId: string
  ts: number
  dir: 'in' | 'out' | 'err' | 'info'
  line: string
}

export interface SendMessageOptions {
  projectId: string
  cwd: string
  text: string
  sessionId?: string
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  allowedTools?: string[]
  /** MCP servers to leave out for this project. */
  disabledMcp?: string[]
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messages: number
}

/** Chat item reconstructed from a stored Claude Code session transcript. */
export type HistoryItem =
  | { type: 'user'; text: string; ts?: number }
  | { type: 'assistant'; text: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }

// ---------------------------------------------------------------- terminal

export interface TerminalCreateOptions {
  projectId: string
  cwd: string
  cols: number
  rows: number
  shell?: string
  /** Command to run inside the shell after it starts (e.g. `claude`). */
  command?: string
}

export interface TerminalInfo {
  id: string
  shell: string
  title: string
}
