import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleSlash,
  FilePen,
  FileSearch,
  Globe,
  KeyRound,
  ListChecks,
  Loader2,
  ShieldAlert,
  SquareTerminal,
  Undo2,
  Wrench,
  X
} from 'lucide-react'
import { memo, useMemo, useState, type MouseEvent } from 'react'
import type { Project } from '@shared/types'
import { renderMarkdown } from '@/lib/markdown'
import { relative } from '@/lib/path'
import { describePermission, formatDuration, summarizeTool, type ToolSummary } from '@/lib/tools'
import { useApp } from '@/store/app'
import { useChat, type ChatItem } from '@/store/chat'
import { openClaudeInTerminal } from '../ClaudeStatus'
import { FileIcon } from '@/lib/fileIcons'
import { Button } from '../ui/Button'
import { basename } from '@/lib/path'

type ToolItem = Extract<ChatItem, { type: 'tool' }>

function onMarkdownClick(e: MouseEvent<HTMLDivElement>): void {
  const target = e.target as HTMLElement
  if (target.matches('[data-copy]')) {
    const code = target.closest('.md-code')?.querySelector('code')?.textContent ?? ''
    navigator.clipboard.writeText(code)
    target.textContent = 'Copied'
    setTimeout(() => (target.textContent = 'Copy'), 1200)
  }
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }): JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className={`md ${streaming ? 'is-streaming' : ''}`} onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: html }} />
})

export function UserMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="msg msg-user">
      <div className="msg-author">You</div>
      <div className="msg-user-bubble">{text}</div>
    </div>
  )
}

export function AssistantMessage({ text, streaming, showAuthor }: { text: string; streaming?: boolean; showAuthor: boolean }): JSX.Element {
  return (
    <div className="msg msg-assistant">
      {showAuthor && (
        <div className="msg-author">
          <span className="claude-mark">✻</span> Claude
        </div>
      )}
      <Markdown text={text} streaming={streaming} />
    </div>
  )
}

export function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`thinking ${open ? 'is-open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)}>
        <Brain size={13} />
        <span>{streaming ? 'Thinking…' : 'Thought process'}</span>
        <ChevronRight size={13} className="chev" />
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  )
}

const KIND_ICON: Record<ToolSummary['kind'], JSX.Element> = {
  read: <FileSearch size={13} />,
  edit: <FilePen size={13} />,
  run: <SquareTerminal size={13} />,
  search: <FileSearch size={13} />,
  web: <Globe size={13} />,
  agent: <Bot size={13} />,
  plan: <ListChecks size={13} />,
  other: <Wrench size={13} />
}

function TodoList({ input }: { input: Record<string, unknown> }): JSX.Element | null {
  const todos = Array.isArray(input.todos) ? (input.todos as { content: string; status: string; activeForm?: string }[]) : []
  if (!todos.length) return null
  return (
    <ul className="todo-list">
      {todos.map((t, i) => (
        <li key={i} className={`todo is-${t.status}`}>
          <span className="todo-box">{t.status === 'completed' ? <Check size={10} strokeWidth={3} /> : t.status === 'in_progress' ? <span className="todo-dot" /> : null}</span>
          <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  )
}

function ToolRow({ item, project }: { item: ToolItem; project: Project }): JSX.Element {
  const [open, setOpen] = useState(false)
  const s = summarizeTool(item.name, item.input, project.path)
  const canOpenFile = !!s.path && (s.kind === 'read' || s.kind === 'edit')
  const app = useApp.getState
  const hasDetail = !!item.result || item.name === 'Bash' || item.name === 'Edit' || item.name === 'Write' || item.name === 'MultiEdit'
  return (
    <div className={`tool-row is-${item.status} kind-${s.kind} ${open ? 'is-open' : ''}`}>
      <button className="tool-row-head" onClick={() => hasDetail && setOpen((o) => !o)}>
        <span className="tool-status">
          {item.status === 'running' ? <Loader2 size={13} className="spin" /> : item.status === 'error' ? <X size={13} /> : <Check size={13} />}
        </span>
        <span className="tool-kind">{KIND_ICON[s.kind]}</span>
        <span className="tool-verb">{s.verb}</span>
        {s.target && (
          <span
            className={`tool-target ${canOpenFile ? 'is-link' : ''} ${s.kind === 'run' ? 'mono' : ''}`}
            onClick={(e) => {
              if (!canOpenFile) return
              e.stopPropagation()
              app().openFile(s.path!)
            }}
          >
            {s.target}
          </span>
        )}
        {hasDetail && <ChevronRight size={13} className="chev" />}
      </button>
      {item.name === 'TodoWrite' && <TodoList input={item.input} />}
      {open && (
        <div className="tool-detail">
          {item.name === 'Bash' && <pre className="tool-code">$ {String(item.input.command ?? '')}</pre>}
          {(item.name === 'Edit' || item.name === 'MultiEdit') && <EditPreview input={item.input} />}
          {item.name === 'Write' && <pre className="tool-code">{String(item.input.content ?? '').slice(0, 3000)}</pre>}
          {item.result && <pre className={`tool-output ${item.status === 'error' ? 'is-error' : ''}`}>{item.result}</pre>}
        </div>
      )}
    </div>
  )
}

function EditPreview({ input }: { input: Record<string, unknown> }): JSX.Element {
  const edits = Array.isArray(input.edits) ? (input.edits as { old_string: string; new_string: string }[]) : [{ old_string: String(input.old_string ?? ''), new_string: String(input.new_string ?? '') }]
  return (
    <div className="mini-diff">
      {edits.slice(0, 6).map((e, i) => (
        <div key={i} className="mini-diff-hunk">
          {e.old_string.split('\n').slice(0, 40).map((l, j) => (
            <div key={'o' + j} className="mini-diff-line is-del">
              <span>-</span>
              {l}
            </div>
          ))}
          {e.new_string.split('\n').slice(0, 40).map((l, j) => (
            <div key={'n' + j} className="mini-diff-line is-add">
              <span>+</span>
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ToolGroup({ items, project }: { items: ToolItem[]; project: Project }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const running = items.some((i) => i.status === 'running')
  const reads = items.filter((i) => ['Read', 'Grep', 'Glob', 'LS'].includes(i.name)).length
  const COLLAPSE_AT = 6
  const visible = expanded || items.length <= COLLAPSE_AT ? items : items.slice(-4)
  return (
    <div className={`tool-group ${running ? 'is-running' : ''}`}>
      {items.length > COLLAPSE_AT && !expanded && (
        <button className="tool-group-more" onClick={() => setExpanded(true)}>
          <ChevronRight size={13} />
          {items.length - visible.length} earlier steps{reads ? ` · analyzed ${reads} file${reads === 1 ? '' : 's'}` : ''}
        </button>
      )}
      {visible.map((it) => (
        <ToolRow key={it.id} item={it} project={project} />
      ))}
    </div>
  )
}

export function PermissionCard({ item, project }: { item: Extract<ChatItem, { type: 'permission' }>; project: Project }): JSX.Element {
  const respond = useChat((s) => s.respond)
  const d = describePermission(item.request.toolName, item.request.input, project.path)
  const isPlan = item.request.toolName === 'ExitPlanMode'
  if (item.state !== 'pending') {
    return (
      <div className={`perm-resolved is-${item.state}`}>
        {item.state === 'allowed' ? <Check size={12} /> : <CircleSlash size={12} />}
        {item.state === 'allowed' ? 'Allowed' : 'Denied'} · {d.title}
      </div>
    )
  }
  return (
    <div className="perm-card">
      <div className="perm-head">
        <ShieldAlert size={15} />
        <span className="perm-title">{isPlan ? 'Claude has a plan' : 'Claude wants to'}</span>
        <span className="perm-tool">{item.request.toolName}</span>
      </div>
      <div className="perm-body">
        <div className="perm-what">{d.title}</div>
        {d.detail && (isPlan ? <Markdown text={d.detail} /> : <div className="perm-detail">{d.detail}</div>)}
        {d.code && <pre className="tool-code">{d.code}</pre>}
      </div>
      <div className="perm-actions">
        <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => respond(project.id, item.id, true)} kbd="↵">
          {isPlan ? 'Approve plan' : 'Allow once'}
        </Button>
        {!isPlan && (
          <Button size="sm" variant="secondary" onClick={() => respond(project.id, item.id, true, true)}>
            Always allow{item.request.toolName === 'Bash' ? ' this command' : ''}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => respond(project.id, item.id, false)} kbd="Esc">
          {isPlan ? 'Keep planning' : 'Deny'}
        </Button>
      </div>
    </div>
  )
}

export function DenialsCard({ item, project }: { item: Extract<ChatItem, { type: 'denials' }>; project: Project }): JSX.Element | null {
  const { retryWithPermission, dismissDenials } = useChat.getState()
  if (item.resolved) return null
  return (
    <div className="perm-card is-retry">
      <div className="perm-head">
        <ShieldAlert size={15} />
        <span className="perm-title">Waiting for permission</span>
      </div>
      <div className="perm-body">
        {item.denials.map((d, i) => {
          const desc = describePermission(d.toolName, d.input, project.path)
          return (
            <div key={i} className="perm-what">
              {desc.title}
              {desc.code && <pre className="tool-code">{desc.code}</pre>}
            </div>
          )
        })}
      </div>
      <div className="perm-actions">
        <Button size="sm" variant="primary" onClick={() => retryWithPermission(project, item.id, false)}>
          Allow &amp; continue
        </Button>
        <Button size="sm" variant="secondary" onClick={() => retryWithPermission(project, item.id, true)}>
          Always allow
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissDenials(project.id, item.id)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

export function ResultFooter({ item, project }: { item: Extract<ChatItem, { type: 'result' }>; project: Project }): JSX.Element {
  const changes = useChat((s) => s.chats[project.id]?.changes ?? [])
  const { accept, reject } = useChat.getState()
  const app = useApp.getState
  const pending = item.changedFiles.filter((f) => changes.some((c) => c.path === f))
  return (
    <div className="result">
      {item.changedFiles.length > 0 && (
        <div className="changed-card">
          <div className="changed-head">
            <span>Changed {item.changedFiles.length} file{item.changedFiles.length === 1 ? '' : 's'}</span>
            {pending.length > 0 ? <span className="changed-pending">{pending.length} pending review</span> : <span className="changed-done">Reviewed</span>}
          </div>
          <div className="changed-files">
            {item.changedFiles.map((f) => {
              const c = changes.find((x) => x.path === f)
              return (
                <button key={f} className={`changed-file ${c ? '' : 'is-settled'}`} onClick={() => (c ? app().openDiff(f, 'claude') : app().openFile(f))}>
                  <FileIcon name={basename(f)} size={13} />
                  <span className="changed-name">{relative(project.path, f)}</span>
                  {c && (
                    <span className="diffstat">
                      <span className="add">+{c.additions}</span>
                      <span className="del">−{c.deletions}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {pending.length > 0 && (
            <div className="changed-actions">
              <Button size="sm" variant="ghost" onClick={() => app().openDiff(pending[0], 'claude')}>
                View changes
              </Button>
              <div className="spacer" />
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => reject(project.id, pending)}>
                Reject
              </Button>
              <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => accept(project.id, pending)}>
                Accept
              </Button>
            </div>
          )}
        </div>
      )}
      <div className={`result-meta ${item.success ? '' : 'is-error'}`}>
        {item.success ? <Check size={12} /> : <AlertTriangle size={12} />}
        <span>{item.success ? 'Completed' : 'Stopped with an error'}</span>
        {item.durationMs ? <span>· {formatDuration(item.durationMs)}</span> : null}
        {item.costUsd ? <span>· ${item.costUsd.toFixed(item.costUsd < 0.1 ? 3 : 2)}</span> : null}
      </div>
    </div>
  )
}

export function ErrorNote({ text }: { text: string }): JSX.Element {
  return (
    <div className="error-note">
      <AlertTriangle size={14} />
      <pre>{text}</pre>
    </div>
  )
}

export function AuthCard({ text }: { text: string }): JSX.Element {
  return (
    <div className="auth-card">
      <KeyRound size={18} />
      <div className="auth-text">
        <div className="auth-title">Claude Code needs to be authenticated.</div>
        <div className="auth-sub">Sign in once in Claude Code — Strata reuses its existing login and never stores your credentials.</div>
        {text && <pre className="auth-detail">{text.slice(0, 400)}</pre>}
      </div>
      <Button variant="primary" size="sm" onClick={openClaudeInTerminal}>
        Open Claude Code
      </Button>
    </div>
  )
}
