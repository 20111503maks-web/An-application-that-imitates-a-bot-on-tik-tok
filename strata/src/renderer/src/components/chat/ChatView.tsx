import { ArrowDown, History, MessageSquarePlus, ScrollText, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Project, SessionSummary } from '@shared/types'
import { timeAgo } from '@/lib/tools'
import { useApp } from '@/store/app'
import { activityOf, useChat, type ChatItem } from '@/store/chat'
import { IconButton } from '../ui/Button'
import { Popover } from '../ui/Popover'
import { Composer } from './Composer'
import { LogDrawer } from './LogDrawer'
import { AssistantMessage, AuthCard, DenialsCard, ErrorNote, PermissionCard, ResultFooter, ThinkingBlock, ToolGroup, UserMessage } from './Messages'

type Block = { kind: 'item'; item: ChatItem } | { kind: 'tools'; id: string; items: Extract<ChatItem, { type: 'tool' }>[] }

function groupItems(items: ChatItem[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (it.type === 'tool') {
      if (last?.kind === 'tools') last.items.push(it)
      else out.push({ kind: 'tools', id: `g-${it.id}`, items: [it] })
    } else {
      out.push({ kind: 'item', item: it })
    }
  }
  return out
}

const SUGGESTIONS: Record<string, string[]> = {
  roblox: ['Explain how the scripts in this game are organized', 'Find bugs in the server scripts', 'Add a leaderstats system with Coins'],
  blender: ['Write a Blender Python script that batch-exports all .blend models to FBX', 'Explain the scripts in this Blender project', 'Create an addon that renames selected objects'],
  node: ['Explain this project’s architecture', 'Find and fix failing tests', 'Add input validation to the API'],
  python: ['Explain what this project does', 'Add type hints and docstrings', 'Write tests for the main module'],
  default: ['Explain this project to me', 'Find potential bugs', 'Write a README for this folder']
}

function EmptyChat({ project }: { project: Project }): JSX.Element {
  const info = useApp((s) => s.infos[project.path])
  const send = useChat((s) => s.send)
  const kind = info?.kinds.find((k) => SUGGESTIONS[k]) ?? (info?.kinds.includes('rojo') ? 'roblox' : 'default')
  const list = SUGGESTIONS[kind] ?? SUGGESTIONS.default
  return (
    <div className="chat-empty">
      <div className="chat-empty-mark">
        <Sparkles size={20} />
      </div>
      <div className="chat-empty-title">Claude Code is ready in {project.name}</div>
      <div className="chat-empty-sub">
        Working directory <span className="mono">{project.path}</span>
      </div>
      <div className="suggestions">
        {list.map((s) => (
          <button key={s} className="suggestion" onClick={() => send(project, s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function SessionsMenu({ project }: { project: Project }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const current = useChat((s) => s.chats[project.id]?.sessionId) ?? project.sessionId
  const resume = useChat((s) => s.resumeSession)

  useEffect(() => {
    if (!open) return
    setSessions(null)
    window.strata.claude.sessions(project.path).then(setSessions).catch(() => setSessions([]))
  }, [open, project.path])

  return (
    <>
      <IconButton ref={ref} tip="Session history" active={open} onClick={() => setOpen((o) => !o)}>
        <History size={15} />
      </IconButton>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} align="end" className="sessions-pop">
        <div className="menu">
          <div className="menu-heading">Claude Code sessions in this folder</div>
          <div className="sessions-list">
            {sessions === null && <div className="menu-empty">Loading…</div>}
            {sessions?.length === 0 && <div className="menu-empty">No previous sessions</div>}
            {sessions?.map((s) => (
              <button
                key={s.id}
                className={`menu-item session-item ${s.id === current ? 'is-selected' : ''}`}
                onClick={() => {
                  setOpen(false)
                  resume(project, s.id)
                }}
              >
                <span className="menu-label">
                  {s.title}
                  <span className="menu-desc">
                    {timeAgo(s.updatedAt)} · {s.messages} messages{s.id === current ? ' · current' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  )
}

export function ChatView({ project, visible }: { project: Project; visible: boolean }): JSX.Element {
  const chat = useChat((s) => s.chats[project.id]) ?? useChat.getState().get(project.id)
  const { loadHistoryIfNeeded, newSession } = useChat.getState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [logOpen, setLogOpen] = useState(false)
  const blocks = useMemo(() => groupItems(chat.items), [chat.items])
  const activity = activityOf(chat)

  useEffect(() => {
    loadHistoryIfNeeded(project)
  }, [project.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [chat.items, stick, visible, activity?.label])

  // Keyboard shortcuts for the newest pending permission prompt.
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      const pending = [...chat.items].reverse().find((i) => i.type === 'permission' && i.state === 'pending')
      if (!pending) return
      const inField = (e.target as HTMLElement)?.closest('textarea, input, .monaco-editor')
      const composerEmpty = !(document.querySelector<HTMLTextAreaElement>('.composer textarea')?.value ?? '')
      if (inField && !composerEmpty) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        useChat.getState().respond(project.id, pending.id, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        useChat.getState().respond(project.id, pending.id, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, chat.items, project.id])

  const title = useMemo(() => {
    const first = chat.items.find((i) => i.type === 'user') as Extract<ChatItem, { type: 'user' }> | undefined
    return first ? first.text.split('\n')[0].slice(0, 80) : 'New session'
  }, [chat.items])

  let prevType: string | null = null

  return (
    <div className="chat" style={{ display: visible ? undefined : 'none' }}>
      <div className="chat-header">
        <div className="chat-title">
          <span className="chat-title-text">{title}</span>
          {chat.sessionId && <span className="chat-session mono" title={chat.sessionId}>{chat.sessionId.slice(0, 8)}</span>}
        </div>
        <div className="chat-header-actions">
          <SessionsMenu project={project} />
          <IconButton tip="Detailed log" active={logOpen} onClick={() => setLogOpen((o) => !o)}>
            <ScrollText size={15} />
          </IconButton>
          <IconButton tip="New session" onClick={() => newSession(project)} disabled={chat.busy}>
            <MessageSquarePlus size={15} />
          </IconButton>
        </div>
      </div>

      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
        }}
      >
        <div className="chat-inner">
          {chat.items.length === 0 ? (
            <EmptyChat project={project} />
          ) : (
            blocks.map((b) => {
              if (b.kind === 'tools') {
                prevType = 'tools'
                return <ToolGroup key={b.id} items={b.items} project={project} />
              }
              const it = b.item
              const showAuthor = it.type === 'assistant' && prevType !== 'assistant' && prevType !== 'tools' && prevType !== 'thinking'
              prevType = it.type
              switch (it.type) {
                case 'user':
                  return <UserMessage key={it.id} text={it.text} />
                case 'assistant':
                  return <AssistantMessage key={it.id} text={it.text} streaming={it.streaming} showAuthor={showAuthor} />
                case 'thinking':
                  return <ThinkingBlock key={it.id} text={it.text} streaming={it.streaming} />
                case 'permission':
                  return <PermissionCard key={it.id} item={it} project={project} />
                case 'denials':
                  return <DenialsCard key={it.id} item={it} project={project} />
                case 'result':
                  return <ResultFooter key={it.id} item={it} project={project} />
                case 'error':
                  return <ErrorNote key={it.id} text={it.text} />
                case 'auth':
                  return <AuthCard key={it.id} text={it.text} />
                case 'notice':
                  return (
                    <div key={it.id} className="chat-notice">
                      <span>{it.text}</span>
                    </div>
                  )
                default:
                  return null
              }
            })
          )}
          {activity && (
            <div className={`activity tone-${activity.tone}`}>
              <span className="activity-dot" />
              <span className="activity-label">{activity.label}</span>
              {activity.detail && <span className="activity-detail">{activity.detail}</span>}
              <Elapsed since={chat.startedAt} />
            </div>
          )}
        </div>
      </div>

      {!stick && (
        <button
          className="scroll-bottom"
          onClick={() => {
            setStick(true)
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          <ArrowDown size={14} />
        </button>
      )}

      <Composer project={project} visible={visible} />
      {logOpen && <LogDrawer project={project} onClose={() => setLogOpen(false)} />}
    </div>
  )
}

function Elapsed({ since }: { since?: number }): JSX.Element | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!since) return null
  const s = Math.floor((Date.now() - since) / 1000)
  return <span className="activity-time">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>
}
