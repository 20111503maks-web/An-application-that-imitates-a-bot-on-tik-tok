import { ArrowUp, AtSign, MessageSquarePlus, Cpu, FileEdit, Map as MapIcon, ShieldCheck, ShieldOff, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DirEntry, PermissionMode, Project } from '@shared/types'
import { FileIcon, FolderIcon } from '@/lib/fileIcons'
import { join } from '@/lib/path'
import { useApp } from '@/store/app'
import { contextOf, formatTokens, useChat } from '@/store/chat'
import { Select, type SelectOption } from '../ui/Select'

const MODES: SelectOption<PermissionMode>[] = [
  { value: 'ask', label: 'Ask first', description: 'Approve every edit and command', icon: <ShieldCheck size={13} /> },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Edits are applied for review; commands need approval', icon: <FileEdit size={13} /> },
  { value: 'plan', label: 'Plan mode', description: 'Claude explores and proposes a plan, no changes', icon: <MapIcon size={13} /> },
  { value: 'bypassPermissions', label: 'Bypass', description: 'Everything runs without asking — use with care', icon: <ShieldOff size={13} /> }
]

const MODELS: SelectOption<string>[] = [
  { value: '', label: 'Default model', description: 'Whatever Claude Code is configured to use' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'sonnet', label: 'Sonnet', description: 'Fast and capable' },
  { value: 'haiku', label: 'Haiku', description: 'Fastest' }
]

const SLASH_COMMANDS = [
  { name: '/clear', desc: 'Start a new chat with an empty context' },
  { name: '/new', desc: 'Same as /clear' }
]

function ContextMeter({ projectId }: { projectId: string }): JSX.Element | null {
  const chat = useChat((s) => s.chats[projectId])
  const ctx = chat ? contextOf(chat) : null
  if (!ctx) return null
  const pct = Math.max(1, Math.round(ctx.ratio * 100))
  return (
    <span
      className={`ctx-meter is-${ctx.level}`}
      data-tip={`Context: ${ctx.tokens.toLocaleString()} of ${ctx.window.toLocaleString()} tokens. Type /clear for a fresh chat.`}
      data-tip-side="top"
    >
      <span className="ctx-ring" style={{ ['--p' as string]: `${pct}%` }} />
      {formatTokens(ctx.tokens)} · {pct}%
    </span>
  )
}

interface Mention {
  start: number
  query: string
  entries: DirEntry[]
  index: number
  dir: string
}

export function Composer({ project, visible }: { project: Project; visible: boolean }): JSX.Element {
  const [text, setText] = useState('')
  const [mention, setMention] = useState<Mention | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const busy = useChat((s) => !!s.chats[project.id]?.busy)
  const chatMode = useChat((s) => s.chats[project.id]?.mode)
  const chatModel = useChat((s) => s.chats[project.id]?.modelOverride)
  const settings = useApp((s) => s.settings)
  const insert = useApp((s) => s.composerInsert)
  const { send, interrupt, setMode, setModel, newSession } = useChat.getState()
  const ctxLevel = useChat((s) => { const c = s.chats[project.id]; return c ? contextOf(c)?.level : undefined })
  const mode = chatMode ?? settings?.permissionMode ?? 'acceptEdits'
  const model = chatModel ?? settings?.model ?? ''

  // Draft per project survives switching tabs/projects.
  const draftKey = `strata.draft.${project.id}`
  useEffect(() => {
    setText(sessionStorage.getItem(draftKey) ?? '')
  }, [draftKey])
  useEffect(() => {
    sessionStorage.setItem(draftKey, text)
  }, [text, draftKey])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 260) + 'px'
  }, [text, visible])

  useEffect(() => {
    if (visible) requestAnimationFrame(() => ref.current?.focus())
  }, [visible])

  useEffect(() => {
    if (!insert || !visible) return
    setText((t) => (t && !t.endsWith(' ') && !t.endsWith('\n') ? t + ' ' : t) + insert.text)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [insert?.nonce])

  const updateMention = async (value: string, caret: number): Promise<void> => {
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@([^\s@]*)$/)
    if (!m) return setMention(null)
    const query = m[2]
    const start = caret - query.length - 1
    const slash = query.lastIndexOf('/')
    const dirRel = slash >= 0 ? query.slice(0, slash) : ''
    const name = (slash >= 0 ? query.slice(slash + 1) : query).toLowerCase()
    const dir = dirRel ? join(project.path, dirRel) : project.path
    try {
      const all = await window.strata.fs.readDir(dir)
      const entries = all
        .filter((e) => !name || e.name.toLowerCase().includes(name))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(name)) - Number(a.name.toLowerCase().startsWith(name)))
        .slice(0, 12)
      setMention(entries.length ? { start, query, entries, index: 0, dir: dirRel } : null)
    } catch {
      setMention(null)
    }
  }

  const pickMention = (entry: DirEntry): void => {
    if (!mention) return
    const rel = (mention.dir ? mention.dir + '/' : '') + entry.name + (entry.isDir ? '/' : ' ')
    const caret = mention.start + 1 + mention.query.length
    const next = text.slice(0, mention.start) + '@' + rel + text.slice(caret)
    setText(next)
    const pos = mention.start + 1 + rel.length
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(pos, pos)
      if (entry.isDir) updateMention(next, pos)
      else setMention(null)
    })
  }

  const isSlash = text.startsWith('/') && !/\s/.test(text)
  const slashMatches = isSlash ? SLASH_COMMANDS.filter((c) => c.name.startsWith(text.toLowerCase())) : []

  const submit = (): void => {
    if (busy || !text.trim()) return
    const cmd = text.trim().toLowerCase()
    if (cmd === '/clear' || cmd === '/new') {
      newSession(project)
      setText('')
      return
    }
    send(project, text)
    setText('')
    setMention(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setMention({ ...mention, index: (mention.index + d + mention.entries.length) % mention.entries.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(mention.entries[mention.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      interrupt(project.id)
    }
  }

  return (
    <div className="composer-wrap">
      {!busy && (ctxLevel === 'long' || ctxLevel === 'full') && (
        <div className={`ctx-banner is-${ctxLevel}`}>
          <span>{ctxLevel === 'full' ? 'Context is almost full — start a new chat so Claude keeps its focus.' : 'This chat is getting long. A new chat is cheaper and keeps answers sharp.'}</span>
          <button onClick={() => newSession(project)}>
            <MessageSquarePlus size={13} /> New chat
          </button>
        </div>
      )}
      <div className={`composer ${busy ? 'is-busy' : ''} mode-${mode}`}>
        {!mention && slashMatches.length > 0 && (
          <div className="mention-pop">
            <div className="mention-head">Commands</div>
            {slashMatches.map((c) => (
              <button
                key={c.name}
                className="mention-item"
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  setText(c.name)
                  ref.current?.focus()
                }}
              >
                <span className="mono">{c.name}</span>
                <span className="muted">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        {mention && (
          <div className="mention-pop">
            <div className="mention-head">Files in {mention.dir || project.name}</div>
            {mention.entries.map((e, i) => (
              <button
                key={e.path}
                className={`mention-item ${i === mention.index ? 'is-active' : ''}`}
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  pickMention(e)
                }}
              >
                {e.isDir ? <FolderIcon name={e.name} size={13} /> : <FileIcon name={e.name} size={13} />}
                <span>{e.name}</span>
                {e.isDir && <span className="muted">/</span>}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={busy ? 'Claude is working… (Esc to interrupt)' : `Ask Claude to modify ${project.name}…`}
          onChange={(e) => {
            setText(e.target.value)
            updateMention(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 120)}
          spellCheck={false}
        />
        <div className="composer-bar">
          <div className="composer-left">
            <button
              className="composer-chip"
              data-tip="Mention a file (@)"
              data-tip-side="top"
              onClick={() => {
                const next = text + (text && !/\s$/.test(text) ? ' @' : '@')
                setText(next)
                ref.current?.focus()
                updateMention(next, next.length)
              }}
            >
              <AtSign size={13} />
            </button>
            <Select compact side="top" value={mode} options={MODES} onChange={(v) => setMode(project.id, v)} className={`mode-select mode-${mode}`} />
            <Select compact side="top" value={model} options={MODELS} onChange={(v) => setModel(project.id, v)} prefix={<Cpu size={12} />} />
          </div>
          <div className="composer-right">
            <ContextMeter projectId={project.id} />
            <span className="composer-hint">
              <kbd className="kbd">↵</kbd> send <kbd className="kbd">⇧↵</kbd> newline
            </span>
            {busy ? (
              <button className="send-btn is-stop" onClick={() => interrupt(project.id)} data-tip="Stop (Esc)" data-tip-side="top">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" disabled={!text.trim()} onClick={submit} data-tip="Send (Enter)" data-tip-side="top">
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
