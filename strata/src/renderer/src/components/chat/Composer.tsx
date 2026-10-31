import { ArrowUp, AtSign, Cpu, FileEdit, Map as MapIcon, ShieldCheck, ShieldOff, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DirEntry, PermissionMode, Project } from '@shared/types'
import { FileIcon, FolderIcon } from '@/lib/fileIcons'
import { join } from '@/lib/path'
import { useApp } from '@/store/app'
import { useChat } from '@/store/chat'
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
  const { send, interrupt, setMode, setModel } = useChat.getState()
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

  const submit = (): void => {
    if (busy || !text.trim()) return
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
      <div className={`composer ${busy ? 'is-busy' : ''} mode-${mode}`}>
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
