import { Copy, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { useChat } from '@/store/chat'
import { IconButton } from '../ui/Button'

const DIRS = { in: '→', out: '←', err: '!', info: '·' } as const

/** Raw protocol log of the Claude Code process, for debugging. */
export function LogDrawer({ project, onClose }: { project: Project; onClose(): void }): JSX.Element {
  const log = useChat((s) => s.chats[project.id]?.log ?? [])
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    useChat.getState().loadLog(project.id)
  }, [project.id])

  const lines = useMemo(() => {
    const f = filter.toLowerCase()
    return (f ? log.filter((l) => l.line.toLowerCase().includes(f)) : log).slice(-1500)
  }, [log, filter])

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div className="log-drawer">
      <div className="log-head">
        <span className="panel-title">Claude Code log</span>
        <input className="input input-sm" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <IconButton tip="Copy log" onClick={() => navigator.clipboard.writeText(lines.map((l) => `${new Date(l.ts).toISOString()} ${l.dir} ${l.line}`).join('\n'))}>
          <Copy size={14} />
        </IconButton>
        <IconButton tip="Close" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="log-body" ref={ref}>
        {lines.length === 0 && <div className="empty-hint">No output yet. Send a message to start Claude Code.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`log-line dir-${l.dir}`}>
            <span className="log-time">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="log-dir">{DIRS[l.dir]}</span>
            <span className="log-text">{l.line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
