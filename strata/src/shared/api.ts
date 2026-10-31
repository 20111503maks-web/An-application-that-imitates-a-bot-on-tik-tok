import type {
  ClaudeEventEnvelope,
  McpServerInfo,
  ClaudeLogLine,
  DirEntry,
  FileContent,
  GitStatus,
  HistoryItem,
  PendingChange,
  Project,
  ProjectInfo,
  SendMessageOptions,
  SessionSummary,
  Settings,
  TerminalCreateOptions,
  TerminalInfo,
  ToolsReport
} from './types'

type Unsubscribe = () => void

/** The API exposed to the renderer via contextBridge as `window.strata`. */
export interface StrataAPI {
  platform: 'win32' | 'darwin' | 'linux' | string
  homeDir: string

  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe
    setZoom(factor: number): void
  }

  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }

  projects: {
    list(): Promise<Project[]>
    pickFolder(multi?: boolean): Promise<string[]>
    pickParentFolder(): Promise<string | null>
    add(path: string): Promise<Project>
    create(parent: string, name: string): Promise<Project>
    remove(id: string): Promise<Project[]>
    update(id: string, patch: Partial<Project>): Promise<Project | null>
    touch(id: string): Promise<void>
    info(path: string): Promise<ProjectInfo>
    mcpServers(path: string): Promise<McpServerInfo[]>
  }

  tools: {
    detect(force?: boolean): Promise<ToolsReport>
    openBlender(file?: string): Promise<{ ok: boolean; error?: string }>
    openRobloxStudio(file?: string): Promise<{ ok: boolean; error?: string }>
    openFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    openClaudeExternal(cwd: string): Promise<{ ok: boolean; error?: string }>
    pickExecutable(): Promise<string | null>
  }

  fs: {
    readDir(path: string): Promise<DirEntry[]>
    readFile(path: string): Promise<FileContent>
    writeFile(path: string, content: string): Promise<void>
    createFile(path: string): Promise<void>
    createDir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    trash(path: string): Promise<void>
    move(from: string, toDir: string): Promise<string>
    copyInto(sources: string[], toDir: string): Promise<string[]>
    exists(path: string): Promise<boolean>
    watch(root: string): Promise<void>
    unwatch(root: string): Promise<void>
    onChanged(cb: (e: { root: string; paths: string[] }) => void): Unsubscribe
    pathForFile(file: File): string
  }

  git: {
    status(cwd: string): Promise<GitStatus>
    stage(cwd: string, paths: string[]): Promise<void>
    unstage(cwd: string, paths: string[]): Promise<void>
    discard(cwd: string, paths: string[]): Promise<void>
    commit(cwd: string, message: string): Promise<string>
    push(cwd: string): Promise<string>
    pull(cwd: string): Promise<string>
    fileAtHead(cwd: string, path: string): Promise<string | null>
    init(cwd: string): Promise<void>
  }

  claude: {
    send(opts: SendMessageOptions): Promise<{ ok: boolean; error?: string }>
    interrupt(projectId: string): Promise<void>
    stop(projectId: string): Promise<void>
    respondPermission(
      projectId: string,
      requestId: string,
      allow: boolean,
      opts?: { always?: boolean; message?: string }
    ): Promise<void>
    sessions(cwd: string): Promise<SessionSummary[]>
    history(cwd: string, sessionId: string): Promise<HistoryItem[]>
    changes(projectId: string): Promise<PendingChange[]>
    acceptChanges(projectId: string, paths?: string[]): Promise<PendingChange[]>
    rejectChanges(projectId: string, paths?: string[]): Promise<PendingChange[]>
    isRunning(projectId: string): Promise<boolean>
    log(projectId: string): Promise<ClaudeLogLine[]>
    onEvent(cb: (e: ClaudeEventEnvelope) => void): Unsubscribe
    onLog(cb: (e: ClaudeLogLine) => void): Unsubscribe
  }

  terminal: {
    create(opts: TerminalCreateOptions): Promise<TerminalInfo>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (e: { id: string; data: string }) => void): Unsubscribe
    onExit(cb: (e: { id: string; code: number }) => void): Unsubscribe
  }
}
