import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  ClaudeEvent,
  ClaudeLogLine,
  PendingChange,
  PermissionMode,
  PermissionRequest,
  SendMessageOptions
} from '@shared/types'
import { ChangeTracker, EDIT_TOOLS } from './changes'
import { childEnv, crossSpawn, killTree } from './exec'
import { assertAllowed, isInside } from './paths'
import { claudePath } from './tools'

const IDLE_SHUTDOWN_MS = 20 * 60 * 1000
const MAX_LOG_LINES = 4000
const MAX_TOOL_RESULT = 6000
const AUTH_PATTERN = /(invalid api key|please run \/login|not logged in|authentication[_ ]error|oauth token (has )?expired|login required|401 unauthorized|credit balance is too low)/i

export interface ClaudeHooks {
  emit(projectId: string, event: ClaudeEvent): void
  log(line: ClaudeLogLine): void
  onSessionId(projectId: string, sessionId: string): void
  onAlwaysAllow(projectId: string, rule: string): void
}

interface Compat {
  partialMessages: boolean
  permissionTool: boolean
}

/** Permission rule string as understood by Claude Code's --allowedTools. */
export function ruleFor(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof input.command === 'string') return `Bash(${input.command})`
  return toolName
}

function ruleMatches(rules: string[], toolName: string, input: Record<string, unknown>): boolean {
  const exact = ruleFor(toolName, input)
  return rules.some((r) => {
    if (r === exact || r === toolName) return true
    // Prefix rules like "Bash(npm run:*)".
    const m = r.match(/^Bash\((.+):\*\)$/)
    return !!m && toolName === 'Bash' && typeof input.command === 'string' && input.command.startsWith(m[1])
  })
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c?.type === 'text') return c.text
        if (c?.type === 'image') return '[image]'
        return ''
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

class ClaudeSession {
  proc: ChildProcess | null = null
  sessionId: string | undefined
  busy = false
  private stdoutBuf = ''
  private stderrTail = ''
  private gotResult = false
  private currentMessageId = ''
  private config = ''
  private idleTimer: NodeJS.Timeout | null = null
  private pending = new Map<string, PermissionRequest>()
  private toolNames = new Map<string, { name: string; input: Record<string, unknown> }>()
  private turnChanged = new Set<string>()
  private allowedRules: string[] = []
  private permissionMode: PermissionMode = 'acceptEdits'
  private queue: string[] = []
  private spawnedAt = 0
  readonly tracker: ChangeTracker
  readonly logLines: ClaudeLogLine[] = []

  constructor(
    readonly projectId: string,
    readonly cwd: string,
    private hooks: ClaudeHooks,
    private compat: Compat
  ) {
    this.tracker = new ChangeTracker(cwd)
  }

  private emit(event: ClaudeEvent): void {
    this.hooks.emit(this.projectId, event)
  }

  log(dir: ClaudeLogLine['dir'], line: string): void {
    const entry: ClaudeLogLine = { projectId: this.projectId, ts: Date.now(), dir, line: line.length > 20000 ? line.slice(0, 20000) + '…' : line }
    this.logLines.push(entry)
    if (this.logLines.length > MAX_LOG_LINES) this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES)
    this.hooks.log(entry)
  }

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null
  }

  send(opts: SendMessageOptions): void {
    const mode = opts.permissionMode ?? 'acceptEdits'
    const model = opts.model ?? ''
    this.allowedRules = [...(opts.allowedTools ?? [])]
    this.permissionMode = mode
    // Process-level options. If they change, restart the CLI and resume the session.
    const config = JSON.stringify({ mode: mode === 'plan' || mode === 'bypassPermissions' ? mode : 'host', model, rules: this.allowedRules })
    if (opts.sessionId && opts.sessionId !== this.sessionId) {
      this.shutdown()
      this.sessionId = opts.sessionId
    }
    if (!opts.sessionId && this.sessionId) {
      // Renderer asked for a brand new conversation.
      this.shutdown()
      this.sessionId = undefined
    }
    if (this.running && this.config !== config) this.shutdown()

    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: opts.text },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? ''
    })
    this.busy = true
    this.gotResult = false
    this.turnChanged.clear()
    this.touchIdle()
    this.emit({ kind: 'status', state: 'busy' })

    if (!this.running) {
      this.config = config
      this.queue = [line]
      this.spawn(model, mode)
    } else {
      this.write(line)
    }
  }

  private spawn(model: string, mode: PermissionMode): void {
    const exe = claudePath()
    if (!exe) {
      this.busy = false
      this.emit({ kind: 'error', message: 'Claude Code CLI was not found. Install it or set its path in Settings → Claude Code.' })
      this.emit({ kind: 'status', state: 'stopped' })
      return
    }
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
    if (this.compat.partialMessages) args.push('--include-partial-messages')
    if (this.compat.permissionTool) args.push('--permission-prompt-tool', 'stdio')
    // Structured questions need a richer UI than a permission card; let Claude ask in plain text.
    args.push('--disallowedTools', 'AskUserQuestion')
    if (model) args.push('--model', model)
    if (mode === 'plan') args.push('--permission-mode', 'plan')
    if (mode === 'bypassPermissions') args.push('--dangerously-skip-permissions')
    if (this.sessionId) args.push('--resume', this.sessionId)
    if (this.allowedRules.length) args.push('--allowedTools', ...this.allowedRules)

    this.log('info', `$ ${exe} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}   (cwd: ${this.cwd})`)
    this.emit({ kind: 'status', state: 'starting' })
    this.stdoutBuf = ''
    this.stderrTail = ''
    this.spawnedAt = Date.now()

    let proc: ChildProcess
    try {
      proc = crossSpawn(exe, args, {
        cwd: this.cwd,
        env: { ...childEnv(), FORCE_COLOR: '0' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      this.busy = false
      this.emit({ kind: 'error', message: `Failed to start Claude Code: ${(err as Error).message}` })
      return
    }
    this.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    proc.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000)
      for (const l of chunk.split(/\r?\n/)) if (l.trim()) this.log('err', l)
    })
    proc.stdin?.on('error', () => undefined)
    proc.on('error', (err) => {
      this.log('err', String(err))
      this.emit({ kind: 'error', message: `Claude Code process error: ${err.message}` })
    })
    proc.on('close', (code) => this.onExit(proc, code))

    for (const l of this.queue) this.write(l)
    this.queue = []
  }

  private write(line: string): void {
    if (!this.proc?.stdin?.writable) {
      this.queue.push(line)
      return
    }
    this.log('in', line)
    this.proc.stdin.write(line + '\n')
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    let idx: number
    while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim()
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1)
      if (!line) continue
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        this.log('out', line)
        continue
      }
      if (msg.type !== 'stream_event') this.log('out', line)
      try {
        this.handle(msg)
      } catch (err) {
        this.log('err', `handler error: ${(err as Error).stack ?? err}`)
      }
    }
  }

  private handle(msg: Record<string, any>): void {
    const sub = msg.parent_tool_use_id != null
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          if (msg.session_id && msg.session_id !== this.sessionId) {
            this.sessionId = msg.session_id
            this.hooks.onSessionId(this.projectId, msg.session_id)
          }
          this.emit({ kind: 'session', sessionId: msg.session_id, model: msg.model, cwd: msg.cwd, tools: msg.tools })
          this.emit({ kind: 'status', state: 'busy' })
        } else if (msg.subtype === 'task_summary' && typeof msg.detail === 'string') {
          this.emit({ kind: 'summary', text: msg.detail })
        }
        return
      }
      case 'stream_event': {
        if (sub) return
        const ev = msg.event ?? {}
        if (ev.type === 'message_start') this.currentMessageId = ev.message?.id ?? randomUUID()
        else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta') this.emit({ kind: 'text-delta', messageId: this.currentMessageId, text: ev.delta.text })
          else if (ev.delta?.type === 'thinking_delta') this.emit({ kind: 'thinking-delta', messageId: this.currentMessageId, text: ev.delta.thinking })
        }
        return
      }
      case 'assistant': {
        const message = msg.message ?? {}
        const content: any[] = Array.isArray(message.content) ? message.content : []
        content.forEach((block, i) => {
          if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>
            this.toolNames.set(block.id, { name: block.name, input })
            if (EDIT_TOOLS.has(block.name)) {
              const p = this.tracker.snapshot(block.name, input)
              if (p) this.turnChanged.add(p)
            }
            if (!sub) this.emit({ kind: 'tool-use', id: block.id, name: block.name, input })
          } else if (sub) {
            return
          } else if (block.type === 'text' && block.text) {
            this.emit({ kind: 'assistant-text', messageId: message.id ?? randomUUID(), blockIndex: i, text: block.text })
          } else if (block.type === 'thinking' && block.thinking) {
            this.emit({ kind: 'thinking', messageId: message.id ?? randomUUID(), blockIndex: i, text: block.thinking })
          }
        })
        return
      }
      case 'user': {
        const content: any[] = Array.isArray(msg.message?.content) ? msg.message.content : []
        let editsFinished = false
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const tool = this.toolNames.get(block.tool_use_id)
          if (tool && EDIT_TOOLS.has(tool.name)) {
            const raw = (tool.input.file_path ?? tool.input.notebook_path) as string | undefined
            if (raw) this.tracker.settle(resolve(this.cwd, raw))
            editsFinished = true
          }
          if (sub) continue
          let text = contentToText(block.content)
          if (text.length > MAX_TOOL_RESULT) text = text.slice(0, MAX_TOOL_RESULT) + `\n… (${text.length - MAX_TOOL_RESULT} more characters)`
          this.emit({ kind: 'tool-result', toolUseId: block.tool_use_id, content: text, isError: !!block.is_error })
        }
        if (editsFinished) this.emit({ kind: 'changes', changes: this.tracker.list() })
        return
      }
      case 'control_request': {
        this.onControlRequest(msg)
        return
      }
      case 'result': {
        this.gotResult = true
        this.busy = false
        const text: string | undefined = typeof msg.result === 'string' ? msg.result : undefined
        const isError = !!msg.is_error || (msg.subtype && msg.subtype !== 'success')
        if (isError && text && AUTH_PATTERN.test(text)) this.emit({ kind: 'auth-required', message: text })
        const denials = Array.isArray(msg.permission_denials)
          ? msg.permission_denials.map((d: any) => ({ toolName: d.tool_name, input: d.tool_input ?? {} }))
          : []
        this.emit({
          kind: 'result',
          success: !isError,
          text,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          numTurns: msg.num_turns,
          error: isError ? text || (Array.isArray(msg.errors) ? msg.errors.join('\n') : msg.subtype) : undefined,
          denials,
          changedFiles: [...this.turnChanged]
        })
        this.emit({ kind: 'changes', changes: this.tracker.list() })
        this.emit({ kind: 'status', state: 'idle' })
        this.touchIdle()
        return
      }
      default:
        return
    }
  }

  private respond(requestId: string, response: Record<string, unknown>): void {
    this.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }))
  }

  private onControlRequest(msg: Record<string, any>): void {
    const requestId: string = msg.request_id
    const req = msg.request ?? {}
    if (req.subtype !== 'can_use_tool') {
      this.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: `Unsupported control request: ${req.subtype}` } }))
      return
    }
    const toolName: string = req.tool_name
    const input = (req.input ?? {}) as Record<string, unknown>

    // "Accept edits" mode: Strata approves file edits inside the project itself — after
    // snapshotting the file, so every change stays reviewable and revertible.
    if (this.permissionMode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
      const raw = (input.file_path ?? input.notebook_path) as string | undefined
      const target = raw ? resolve(this.cwd, raw) : null
      if (target && isInside(this.cwd, target)) {
        const p = this.tracker.snapshot(toolName, input)
        if (p) this.turnChanged.add(p)
        this.respond(requestId, { behavior: 'allow', updatedInput: input })
        return
      }
    }
    if (ruleMatches(this.allowedRules, toolName, input)) {
      if (EDIT_TOOLS.has(toolName)) this.tracker.snapshot(toolName, input)
      this.respond(requestId, { behavior: 'allow', updatedInput: input })
      return
    }
    const request: PermissionRequest = {
      requestId,
      toolName,
      toolUseId: req.tool_use_id,
      input,
      description: typeof req.description === 'string' ? req.description : undefined
    }
    this.pending.set(requestId, request)
    this.emit({ kind: 'permission', request })
  }

  respondPermission(requestId: string, allow: boolean, always?: boolean, message?: string): void {
    const req = this.pending.get(requestId)
    if (!req) return
    this.pending.delete(requestId)
    if (allow) {
      if (EDIT_TOOLS.has(req.toolName)) {
        const p = this.tracker.snapshot(req.toolName, req.input)
        if (p) this.turnChanged.add(p)
      }
      if (always) {
        const rule = ruleFor(req.toolName, req.input)
        if (!this.allowedRules.includes(rule)) this.allowedRules.push(rule)
        this.hooks.onAlwaysAllow(this.projectId, rule)
      }
      this.respond(requestId, { behavior: 'allow', updatedInput: req.input })
    } else {
      this.respond(requestId, { behavior: 'deny', message: message || 'The user denied this action. Ask how they would like to proceed.' })
    }
    this.emit({ kind: 'permission-resolved', requestId, allowed: allow })
  }

  interrupt(): void {
    if (!this.running) return
    for (const id of [...this.pending.keys()]) this.respondPermission(id, false, false, 'Interrupted by the user.')
    this.write(JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }))
    const proc = this.proc
    // If the CLI does not wind down promptly, stop it; the session resumes next message.
    setTimeout(() => {
      if (this.proc === proc && this.busy) this.shutdown()
    }, 4000).unref()
  }

  private onExit(proc: ChildProcess, code: number | null): void {
    if (this.proc !== proc) return
    this.proc = null
    for (const id of [...this.pending.keys()]) this.emit({ kind: 'permission-resolved', requestId: id, allowed: false })
    this.pending.clear()
    this.log('info', `claude exited with code ${code}`)
    const tail = this.stderrTail.trim()

    // Older CLI versions: retry without flags they do not understand.
    if (!this.gotResult && this.busy && Date.now() - this.spawnedAt < 15000 && /unknown option|unrecognized|invalid option/i.test(tail)) {
      if (this.compat.partialMessages && /include-partial-messages/.test(tail)) {
        this.compat.partialMessages = false
        return this.retryLastTurn()
      }
      if (this.compat.permissionTool && /permission-prompt-tool/.test(tail)) {
        this.compat.permissionTool = false
        return this.retryLastTurn()
      }
    }

    if (this.busy && !this.gotResult) {
      this.busy = false
      if (AUTH_PATTERN.test(tail)) this.emit({ kind: 'auth-required', message: tail.split('\n').slice(-3).join('\n') })
      else if (code !== 0 && code !== null) this.emit({ kind: 'error', message: tail ? tail.split('\n').slice(-8).join('\n') : `Claude Code exited with code ${code}` })
      this.emit({ kind: 'changes', changes: this.tracker.list() })
    }
    this.emit({ kind: 'exit', code })
    this.emit({ kind: 'status', state: 'stopped' })
  }

  private lastUserLine(): string | null {
    for (let i = this.logLines.length - 1; i >= 0; i--) {
      const l = this.logLines[i]
      if (l.dir === 'in' && l.line.startsWith('{"type":"user"')) return l.line
    }
    return null
  }

  private retryLastTurn(): void {
    const line = this.lastUserLine()
    if (!line) return
    this.log('info', 'retrying with compatibility flags')
    this.queue = [line]
    this.spawn(JSON.parse(this.config).model, this.permissionMode)
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (!this.busy) this.shutdown()
    }, IDLE_SHUTDOWN_MS)
    this.idleTimer.unref()
  }

  shutdown(): void {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    this.busy = false
    this.pending.clear()
    try {
      proc.stdin?.end()
    } catch {
      /* ignore */
    }
    killTree(proc)
    this.emit({ kind: 'status', state: 'stopped' })
  }
}

/** Owns one Claude Code CLI process per project (each with its own working directory). */
export class ClaudeManager {
  private sessions = new Map<string, ClaudeSession>()
  private compat: Compat = { partialMessages: true, permissionTool: true }

  constructor(private hooks: ClaudeHooks) {}

  setPartialMessages(enabled: boolean): void {
    this.compat.partialMessages = enabled
  }

  private session(projectId: string, cwd: string): ClaudeSession {
    let s = this.sessions.get(projectId)
    if (s && s.cwd !== cwd) {
      s.shutdown()
      s = undefined
    }
    if (!s) {
      s = new ClaudeSession(projectId, cwd, this.hooks, this.compat)
      this.sessions.set(projectId, s)
    }
    return s
  }

  send(opts: SendMessageOptions): { ok: boolean; error?: string } {
    const cwd = assertAllowed(opts.cwd)
    const s = this.session(opts.projectId, cwd)
    if (s.busy) return { ok: false, error: 'Claude is still working on the previous message.' }
    s.send({ ...opts, cwd })
    return { ok: true }
  }

  interrupt(projectId: string): void {
    this.sessions.get(projectId)?.interrupt()
  }

  stop(projectId: string): void {
    const s = this.sessions.get(projectId)
    if (!s) return
    s.shutdown()
    s.sessionId = undefined
  }

  respondPermission(projectId: string, requestId: string, allow: boolean, always?: boolean, message?: string): void {
    this.sessions.get(projectId)?.respondPermission(requestId, allow, always, message)
  }

  isRunning(projectId: string): boolean {
    return !!this.sessions.get(projectId)?.busy
  }

  changes(projectId: string): PendingChange[] {
    return this.sessions.get(projectId)?.tracker.list() ?? []
  }

  accept(projectId: string, paths?: string[]): PendingChange[] {
    const s = this.sessions.get(projectId)
    if (!s) return []
    s.tracker.accept(paths)
    return s.tracker.list()
  }

  async reject(projectId: string, paths?: string[]): Promise<PendingChange[]> {
    const s = this.sessions.get(projectId)
    if (!s) return []
    await s.tracker.reject(paths)
    return s.tracker.list()
  }

  log(projectId: string): ClaudeLogLine[] {
    return this.sessions.get(projectId)?.logLines ?? []
  }

  shutdownAll(): void {
    for (const s of this.sessions.values()) s.shutdown()
  }
}
