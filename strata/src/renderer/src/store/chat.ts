import { create } from 'zustand'
import type { ClaudeEvent, ClaudeLogLine, HistoryItem, PendingChange, PermissionMode, PermissionRequest, Project } from '@shared/types'
import { useApp } from './app'
import { toast } from './toast'

export type ChatItem =
  | { type: 'user'; id: string; text: string; ts: number }
  | { type: 'assistant'; id: string; text: string; streaming?: boolean }
  | { type: 'thinking'; id: string; text: string; streaming?: boolean }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown>; status: 'running' | 'done' | 'error'; result?: string }
  | { type: 'permission'; id: string; request: PermissionRequest; state: 'pending' | 'allowed' | 'denied' }
  | { type: 'result'; id: string; success: boolean; costUsd?: number; durationMs?: number; changedFiles: string[]; error?: string }
  | { type: 'denials'; id: string; denials: { toolName: string; input: Record<string, unknown> }[]; resolved?: boolean }
  | { type: 'error'; id: string; text: string }
  | { type: 'auth'; id: string; text: string }
  | { type: 'notice'; id: string; text: string }

export type ChatStatus = 'idle' | 'starting' | 'busy' | 'stopped'

export interface ChatState {
  items: ChatItem[]
  status: ChatStatus
  busy: boolean
  sessionId?: string
  model?: string
  changes: PendingChange[]
  summary?: string
  startedAt?: number
  authRequired: boolean
  historyLoaded: boolean
  log: ClaudeLogLine[]
  mode?: PermissionMode
  modelOverride?: string
}

const emptyChat = (): ChatState => ({
  items: [],
  status: 'stopped',
  busy: false,
  changes: [],
  authRequired: false,
  historyLoaded: false,
  log: []
})

const EMPTY = emptyChat()

interface ChatStore {
  chats: Record<string, ChatState>
  get(projectId: string): ChatState
  send(project: Project, text: string): Promise<void>
  interrupt(projectId: string): void
  newSession(project: Project): Promise<void>
  resumeSession(project: Project, sessionId: string): Promise<void>
  loadHistoryIfNeeded(project: Project): Promise<void>
  respond(projectId: string, requestId: string, allow: boolean, always?: boolean): Promise<void>
  retryWithPermission(project: Project, itemId: string, always: boolean): Promise<void>
  dismissDenials(projectId: string, itemId: string): void
  refreshChanges(projectId: string): Promise<void>
  accept(projectId: string, paths?: string[]): Promise<void>
  reject(projectId: string, paths?: string[]): Promise<void>
  setMode(projectId: string, mode: PermissionMode): void
  setModel(projectId: string, model: string): void
  apply(projectId: string, event: ClaudeEvent): void
  appendLog(line: ClaudeLogLine): void
  loadLog(projectId: string): Promise<void>
}

let seq = 0
const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export interface Activity {
  label: string
  detail?: string
  tone: 'think' | 'read' | 'edit' | 'run' | 'wait' | 'web' | 'write'
}

/** Human-readable "what is Claude doing right now". */
export function activityOf(chat: ChatState): Activity | null {
  if (!chat.busy) return null
  if (chat.status === 'starting') return { label: 'Starting Claude Code', tone: 'think' }
  const items = chat.items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'user') break
    if (it.type === 'permission' && it.state === 'pending') return { label: 'Waiting for permission', detail: it.request.toolName, tone: 'wait' }
  }
  const last = items[items.length - 1]
  if (last?.type === 'assistant' && last.streaming) return { label: 'Writing response', tone: 'write' }
  if (last?.type === 'thinking' && last.streaming) return { label: 'Thinking', tone: 'think', detail: chat.summary }
  const running = [...items].reverse().find((i): i is Extract<ChatItem, { type: 'tool' }> => i.type === 'tool' && i.status === 'running')
  if (running) {
    const detail = chat.summary
    if (READ_TOOLS.has(running.name)) return { label: 'Reading files', detail, tone: 'read' }
    if (EDIT_TOOLS.has(running.name)) return { label: 'Editing files', detail, tone: 'edit' }
    if (running.name === 'Bash' || running.name === 'BashOutput') return { label: 'Running command', detail: String(running.input.command ?? '').slice(0, 80), tone: 'run' }
    if (running.name === 'WebFetch' || running.name === 'WebSearch') return { label: 'Searching the web', detail, tone: 'web' }
    if (running.name === 'Task' || running.name === 'Agent') return { label: 'Running sub-agent', detail: String(running.input.description ?? ''), tone: 'think' }
    if (running.name === 'TodoWrite') return { label: 'Planning', tone: 'think' }
    return { label: `Using ${running.name}`, detail, tone: 'run' }
  }
  return { label: 'Thinking', detail: chat.summary, tone: 'think' }
}

function fromHistory(items: HistoryItem[]): ChatItem[] {
  return items.map((h): ChatItem => {
    if (h.type === 'user') return { type: 'user', id: uid('u'), text: h.text, ts: h.ts ?? 0 }
    if (h.type === 'assistant') return { type: 'assistant', id: uid('a'), text: h.text }
    return { type: 'tool', id: h.id, name: h.name, input: h.input, status: h.isError ? 'error' : 'done', result: h.result }
  })
}

function permissionRule(toolName: string, input: Record<string, unknown>): string {
  return toolName === 'Bash' && typeof input.command === 'string' ? `Bash(${input.command})` : toolName
}

export const useChat = create<ChatStore>((set, get) => {
  const patch = (projectId: string, fn: (c: ChatState) => Partial<ChatState>): void => {
    set((s) => {
      const cur = s.chats[projectId] ?? emptyChat()
      return { chats: { ...s.chats, [projectId]: { ...cur, ...fn(cur) } } }
    })
  }

  const doSend = async (project: Project, text: string, extraRules: string[] = []): Promise<void> => {
    const settings = useApp.getState().settings
    const chat = get().get(project.id)
    const fresh = useApp.getState().projects.find((p) => p.id === project.id) ?? project
    const res = await window.strata.claude.send({
      projectId: project.id,
      cwd: project.path,
      text,
      sessionId: chat.sessionId ?? fresh.sessionId,
      model: chat.modelOverride ?? settings?.model ?? '',
      permissionMode: chat.mode ?? settings?.permissionMode ?? 'acceptEdits',
      allowedTools: [...(fresh.allowedTools ?? []), ...extraRules]
    })
    if (!res.ok) {
      patch(project.id, (c) => ({ busy: false, items: [...c.items, { type: 'error', id: uid('e'), text: res.error ?? 'Failed to send message' }] }))
    }
  }

  return {
    chats: {},

    get(projectId) {
      return get().chats[projectId] ?? EMPTY
    },

    async send(project, text) {
      const trimmed = text.trim()
      if (!trimmed) return
      if (get().get(project.id).busy) return
      patch(project.id, (c) => ({
        items: [...c.items, { type: 'user', id: uid('u'), text: trimmed, ts: Date.now() }],
        busy: true,
        status: c.status === 'stopped' ? 'starting' : 'busy',
        startedAt: Date.now(),
        summary: undefined,
        authRequired: false,
        historyLoaded: true
      }))
      try {
        await doSend(project, trimmed)
      } catch (err) {
        patch(project.id, (c) => ({ busy: false, items: [...c.items, { type: 'error', id: uid('e'), text: (err as Error).message }] }))
      }
    },

    interrupt(projectId) {
      window.strata.claude.interrupt(projectId)
      patch(projectId, (c) => ({ items: [...c.items, { type: 'notice', id: uid('n'), text: 'Interrupted' }] }))
    },

    async newSession(project) {
      await window.strata.claude.stop(project.id)
      await useApp.getState().updateProject(project.id, { sessionId: undefined })
      patch(project.id, (c) => ({ ...emptyChat(), changes: c.changes, historyLoaded: true, mode: c.mode, modelOverride: c.modelOverride, log: c.log }))
    },

    async resumeSession(project, sessionId) {
      await window.strata.claude.stop(project.id)
      await useApp.getState().updateProject(project.id, { sessionId })
      const history = await window.strata.claude.history(project.path, sessionId).catch(() => [])
      patch(project.id, (c) => ({
        ...emptyChat(),
        changes: c.changes,
        mode: c.mode,
        modelOverride: c.modelOverride,
        log: c.log,
        sessionId,
        historyLoaded: true,
        items: [...fromHistory(history), { type: 'notice', id: uid('n'), text: 'Session resumed — new messages continue this conversation' }]
      }))
    },

    async loadHistoryIfNeeded(project) {
      const chat = get().get(project.id)
      if (chat.historyLoaded) return
      patch(project.id, () => ({ historyLoaded: true }))
      const [changes, running] = await Promise.all([window.strata.claude.changes(project.id), window.strata.claude.isRunning(project.id)])
      patch(project.id, () => ({ changes, busy: running }))
      if (!project.sessionId) return
      const history = await window.strata.claude.history(project.path, project.sessionId).catch(() => [])
      if (!history.length) return
      patch(project.id, (c) => ({
        sessionId: project.sessionId,
        items: [...fromHistory(history), { type: 'notice', id: uid('n'), text: 'Continuing previous session' }, ...c.items]
      }))
    },

    async respond(projectId, requestId, allow, always) {
      await window.strata.claude.respondPermission(projectId, requestId, allow, { always })
      if (always) {
        const p = useApp.getState().projects.find((x) => x.id === projectId)
        if (p) useApp.getState().updateProject(projectId, {})
      }
    },

    async retryWithPermission(project, itemId, always) {
      const chat = get().get(project.id)
      const item = chat.items.find((i) => i.id === itemId)
      if (!item || item.type !== 'denials' || chat.busy) return
      const rules = [...new Set(item.denials.map((d) => permissionRule(d.toolName, d.input)))]
      if (always) await useApp.getState().updateProject(project.id, { allowedTools: [...new Set([...(project.allowedTools ?? []), ...rules])] })
      const text = `Permission granted for: ${rules.join(', ')}. Please continue.`
      patch(project.id, (c) => ({
        items: [...c.items.map((i) => (i.id === itemId ? { ...i, resolved: true } : i)), { type: 'user', id: uid('u'), text, ts: Date.now() }],
        busy: true,
        startedAt: Date.now()
      }))
      await doSend(project, text, rules)
    },

    dismissDenials(projectId, itemId) {
      patch(projectId, (c) => ({ items: c.items.map((i) => (i.id === itemId ? { ...i, resolved: true } : i)) }))
    },

    async refreshChanges(projectId) {
      const changes = await window.strata.claude.changes(projectId)
      patch(projectId, () => ({ changes }))
    },

    async accept(projectId, paths) {
      const changes = await window.strata.claude.acceptChanges(projectId, paths)
      patch(projectId, () => ({ changes }))
      toast.success(paths?.length === 1 ? 'Change accepted' : 'Changes accepted')
    },

    async reject(projectId, paths) {
      try {
        const changes = await window.strata.claude.rejectChanges(projectId, paths)
        patch(projectId, () => ({ changes }))
        toast.info(paths?.length === 1 ? 'Change reverted' : 'Changes reverted')
      } catch (err) {
        toast.error('Could not revert', (err as Error).message)
      }
    },

    setMode(projectId, mode) {
      patch(projectId, () => ({ mode }))
    },

    setModel(projectId, model) {
      patch(projectId, () => ({ modelOverride: model }))
    },

    apply(projectId, e) {
      patch(projectId, (c) => {
        const items = c.items
        switch (e.kind) {
          case 'status':
            if (e.state === 'busy' || e.state === 'starting') return { status: e.state }
            if (e.state === 'stopped') return { status: 'stopped', busy: false, items: items.map(endStreaming) }
            return { status: 'idle' }
          case 'session':
            return { sessionId: e.sessionId, model: e.model, status: 'busy' }
          case 'summary':
            return { summary: e.text }
          case 'text-delta':
          case 'thinking-delta': {
            const type = e.kind === 'text-delta' ? 'assistant' : 'thinking'
            const sid = `stream:${type}:${e.messageId}`
            const last = items[items.length - 1]
            if (last && last.id === sid && (last.type === 'assistant' || last.type === 'thinking')) {
              return { items: [...items.slice(0, -1), { ...last, text: last.text + e.text }] }
            }
            return { items: [...items, { type, id: sid, text: e.text, streaming: true } as ChatItem] }
          }
          case 'assistant-text':
          case 'thinking': {
            const type = e.kind === 'assistant-text' ? 'assistant' : 'thinking'
            const sid = `stream:${type}:${e.messageId}`
            const id = `${type}:${e.messageId}:${e.blockIndex}`
            const final = { type, id, text: e.text } as ChatItem
            const idx = items.findIndex((i) => i.id === sid)
            if (idx >= 0) return { items: [...items.slice(0, idx), final, ...items.slice(idx + 1)] }
            if (items.some((i) => i.id === id)) return {}
            return { items: [...items, final] }
          }
          case 'tool-use': {
            if (items.some((i) => i.id === e.id)) return {}
            return { items: [...items.map(endStreaming), { type: 'tool', id: e.id, name: e.name, input: e.input, status: 'running' }] }
          }
          case 'tool-result':
            return {
              items: items.map((i) => (i.type === 'tool' && i.id === e.toolUseId ? { ...i, status: e.isError ? 'error' : 'done', result: e.content } : i))
            }
          case 'permission':
            return { items: [...items.map(endStreaming), { type: 'permission', id: e.request.requestId, request: e.request, state: 'pending' }] }
          case 'permission-resolved':
            return {
              items: items.map((i) => (i.type === 'permission' && i.id === e.requestId && i.state === 'pending' ? { ...i, state: e.allowed ? 'allowed' : 'denied' } : i))
            }
          case 'changes':
            return { changes: e.changes }
          case 'result': {
            const next: ChatItem[] = items.map(endStreaming).map((i) => (i.type === 'tool' && i.status === 'running' ? { ...i, status: 'done' } : i))
            // With live permission prompts the user already decided; the retry card is only a
            // fallback for CLI versions that cannot ask the host for permission.
            let lastUser = next.length - 1
            while (lastUser >= 0 && next[lastUser].type !== 'user') lastUser--
            const askedLive = next.slice(lastUser + 1).some((i) => i.type === 'permission')
            const denials = askedLive ? [] : e.denials
            if (denials.length) next.push({ type: 'denials', id: uid('d'), denials })
            if (!e.success && e.error) next.push({ type: 'error', id: uid('e'), text: e.error })
            next.push({ type: 'result', id: uid('r'), success: e.success, costUsd: e.costUsd, durationMs: e.durationMs, changedFiles: e.changedFiles, error: e.error })
            return { items: next, busy: false, status: 'idle', summary: undefined }
          }
          case 'auth-required':
            if (items.some((i) => i.type === 'auth')) return { authRequired: true }
            return { authRequired: true, items: [...items, { type: 'auth', id: uid('auth'), text: e.message }] }
          case 'error':
            return { items: [...items.map(endStreaming), { type: 'error', id: uid('e'), text: e.message }] }
          case 'exit':
            return { busy: false, items: items.map(endStreaming).map((i) => (i.type === 'tool' && i.status === 'running' ? { ...i, status: 'error' } : i)) }
          default:
            return {}
        }
      })
    },

    appendLog(line) {
      const chat = get().chats[line.projectId]
      if (!chat) return
      const log = chat.log.length > 3000 ? [...chat.log.slice(-2500), line] : [...chat.log, line]
      patch(line.projectId, () => ({ log }))
    },

    async loadLog(projectId) {
      const log = await window.strata.claude.log(projectId)
      patch(projectId, () => ({ log }))
    }
  }
})

function endStreaming(i: ChatItem): ChatItem {
  return (i.type === 'assistant' || i.type === 'thinking') && i.streaming ? { ...i, streaming: false } : i
}

let wired = false
/** Connects the chat store to Claude events coming from the main process. Call once. */
export function wireChatEvents(): void {
  if (wired) return
  wired = true
  window.strata.claude.onEvent(({ projectId, event }) => {
    useChat.getState().apply(projectId, event)
    if (event.kind === 'session') {
      const app = useApp.getState()
      const p = app.projects.find((x) => x.id === projectId)
      if (p && p.sessionId !== event.sessionId) useApp.setState({ projects: app.projects.map((x) => (x.id === projectId ? { ...x, sessionId: event.sessionId } : x)) })
    }
    if (event.kind === 'result') {
      useApp.getState().refreshGit(projectId)
      if (!document.hasFocus() && event.success) {
        try {
          new Notification('Claude finished', { body: (event.text ?? 'Task completed').slice(0, 140), silent: true })
        } catch {
          /* notifications unavailable */
        }
      }
    }
    if (event.kind === 'permission' && !document.hasFocus()) {
      try {
        new Notification('Claude needs permission', { body: event.request.toolName, silent: false })
      } catch {
        /* ignore */
      }
    }
  })
  window.strata.claude.onLog((line) => useChat.getState().appendLog(line))
}
