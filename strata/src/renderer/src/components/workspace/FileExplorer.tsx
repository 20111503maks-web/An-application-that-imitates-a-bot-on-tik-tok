import {
  AtSign,
  Box,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Gamepad2,
  ListCollapse,
  Pencil,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry, Project } from '@shared/types'
import { FileIcon, FolderIcon } from '@/lib/fileIcons'
import { onFsChange } from '@/lib/fsEvents'
import { basename, dirname, extname, isInside, join, relative, samePath } from '@/lib/path'
import { useApp } from '@/store/app'
import { useChat } from '@/store/chat'
import { toast } from '@/store/toast'
import { confirmDialog } from '../ui/Dialog'
import { openContextMenu, type MenuItem } from '../ui/Menu'

const ROW = 24
const OVERSCAN = 8

type Row =
  | { kind: 'entry'; entry: DirEntry; depth: number }
  | { kind: 'input'; depth: number; parent: string; mode: 'newFile' | 'newDir' }

interface Editing {
  mode: 'rename' | 'newFile' | 'newDir'
  path: string
}

const DRAG_MIME = 'application/x-strata-path'

function gitLetter(index: string, work: string): string {
  if (index === '?' || work === '?') return 'U'
  if (index === 'A') return 'A'
  if (index === 'D' || work === 'D') return 'D'
  if (index === 'R') return 'R'
  return 'M'
}

export function FileExplorer({ project }: { project: Project }): JSX.Element {
  const root = project.path
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(`strata.tree.${project.id}`) ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loading = useRef(new Set<string>())
  const git = useApp((s) => s.git[project.id])
  const changes = useChat((s) => s.chats[project.id]?.changes)
  const revealReq = useApp((s) => s.revealPath)
  const app = useApp.getState
  const childrenRef = useRef(children)
  childrenRef.current = children

  const load = useCallback(async (dir: string): Promise<void> => {
    if (loading.current.has(dir)) return
    loading.current.add(dir)
    try {
      const entries = await window.strata.fs.readDir(dir)
      setChildren((m) => new Map(m).set(dir, entries))
      if (dir === root) setError(null)
    } catch (err) {
      if (dir === root) setError((err as Error).message)
      setChildren((m) => {
        const next = new Map(m)
        next.delete(dir)
        return next
      })
    } finally {
      loading.current.delete(dir)
    }
  }, [root])

  useEffect(() => {
    load(root)
    for (const d of expanded) if (isInside(root, d)) load(d)
  }, [root])

  useEffect(() => {
    sessionStorage.setItem(`strata.tree.${project.id}`, JSON.stringify([...expanded]))
  }, [expanded, project.id])

  // Refresh only the directories that actually changed.
  useEffect(() => {
    return onFsChange(({ root: r, paths }) => {
      if (!isInside(root, r) && !isInside(r, root)) return
      const dirs = new Set<string>()
      for (const p of paths) {
        dirs.add(dirname(p))
        dirs.add(p)
      }
      const keys = [...childrenRef.current.keys()]
      for (const d of dirs) {
        const hit = keys.find((k) => samePath(k, d))
        if (hit) load(hit)
      }
    })
  }, [root, load])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const toggle = (dir: string, open?: boolean): void => {
    setExpanded((s) => {
      const next = new Set(s)
      const willOpen = open ?? !next.has(dir)
      if (willOpen) {
        next.add(dir)
        if (!children.has(dir)) load(dir)
      } else next.delete(dir)
      return next
    })
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      if (editing && (editing.mode === 'newFile' || editing.mode === 'newDir') && samePath(editing.path, dir)) {
        out.push({ kind: 'input', depth, parent: dir, mode: editing.mode })
      }
      for (const e of children.get(dir) ?? []) {
        out.push({ kind: 'entry', entry: e, depth })
        if (e.isDir && expanded.has(e.path)) walk(e.path, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }, [children, expanded, root, editing])

  const decorations = useMemo(() => {
    const files = new Map<string, string>()
    const dirs = new Set<string>()
    const mark = (abs: string, letter: string): void => {
      files.set(abs.replace(/\\/g, '/').toLowerCase(), letter)
      let d = dirname(abs)
      while (isInside(root, d) && !samePath(d, root)) {
        dirs.add(d.replace(/\\/g, '/').toLowerCase())
        const up = dirname(d)
        if (up === d) break
        d = up
      }
    }
    if (git?.isRepo && git.root) for (const f of git.files) mark(join(git.root, f.path), gitLetter(f.index, f.work))
    for (const c of changes ?? []) mark(c.path, 'C')
    return { files, dirs }
  }, [git, changes, root])

  // Reveal requests (from tool cards, editor tabs, ...).
  useEffect(() => {
    if (!revealReq || !isInside(root, revealReq.path)) return
    const chain: string[] = []
    let d = dirname(revealReq.path)
    while (isInside(root, d) && !samePath(d, root)) {
      chain.unshift(d)
      d = dirname(d)
    }
    setExpanded((s) => new Set([...s, ...chain]))
    chain.forEach((c) => load(c))
    setSelected(revealReq.path)
    setTimeout(() => {
      const idx = rowsRef.current.findIndex((r) => r.kind === 'entry' && samePath(r.entry.path, revealReq.path))
      if (idx >= 0 && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, idx * ROW - height / 2)
    }, 150)
  }, [revealReq?.nonce])
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)

  const targetDirFor = (path: string | null): string => {
    if (!path) return root
    const row = rows.find((r) => r.kind === 'entry' && r.entry.path === path)
    if (row && row.kind === 'entry') return row.entry.isDir ? row.entry.path : dirname(row.entry.path)
    return root
  }

  const beginCreate = (mode: 'newFile' | 'newDir', dir: string): void => {
    if (!samePath(dir, root)) toggle(dir, true)
    setEditing({ mode, path: dir })
  }

  const commitEdit = async (value: string): Promise<void> => {
    const ed = editing
    setEditing(null)
    const name = value.trim()
    if (!ed || !name) return
    if (/[<>:"|?*]/.test(name) || name.includes('..')) {
      toast.error('Invalid name', name)
      return
    }
    try {
      if (ed.mode === 'rename') {
        if (name === basename(ed.path)) return
        const to = join(dirname(ed.path), name)
        await window.strata.fs.rename(ed.path, to)
        app().renameTabPath(ed.path, to)
        setSelected(to)
        await load(dirname(ed.path))
      } else {
        const target = join(ed.path, name)
        if (ed.mode === 'newFile') {
          await window.strata.fs.createFile(target)
          app().openFile(target)
        } else {
          await window.strata.fs.createDir(target)
          setExpanded((s) => new Set(s).add(target))
        }
        setSelected(target)
        await load(ed.path)
      }
    } catch (err) {
      toast.error(ed.mode === 'rename' ? 'Rename failed' : 'Create failed', (err as Error).message)
    }
  }

  const trash = async (path: string): Promise<void> => {
    const ok = await confirmDialog({
      title: `Delete “${basename(path)}”?`,
      message: 'It will be moved to the Recycle Bin, so you can restore it later.',
      confirmLabel: 'Move to Recycle Bin',
      danger: true
    })
    if (!ok) return
    try {
      await window.strata.fs.trash(path)
      app().closeTab(`file:${path}`)
      await load(dirname(path))
    } catch (err) {
      toast.error('Delete failed', (err as Error).message)
    }
  }

  const contextItems = (entry: DirEntry | null): MenuItem[] => {
    const dir = entry ? (entry.isDir ? entry.path : dirname(entry.path)) : root
    const items: MenuItem[] = [
      { label: 'New file', icon: <FilePlus size={14} />, onSelect: () => beginCreate('newFile', dir) },
      { label: 'New folder', icon: <FolderPlus size={14} />, onSelect: () => beginCreate('newDir', dir) }
    ]
    if (!entry) return [...items, { separator: true }, { label: 'Reveal in file manager', icon: <ExternalLink size={14} />, onSelect: () => window.strata.tools.openFolder(root) }]
    const ext = extname(entry.name)
    items.push({ separator: true })
    items.push({ label: 'Ask Claude about this', icon: <AtSign size={14} />, onSelect: () => app().insertIntoComposer(`@${relative(root, entry.path)}${entry.isDir ? '/' : ''} `) })
    if (ext === '.blend') items.push({ label: 'Open in Blender', icon: <Box size={14} />, onSelect: () => openBlender(entry.path) })
    if (ext === '.rbxl' || ext === '.rbxlx') items.push({ label: 'Open in Roblox Studio', icon: <Gamepad2 size={14} />, onSelect: () => openRoblox(entry.path) })
    items.push(
      { separator: true },
      { label: 'Rename', icon: <Pencil size={14} />, hint: 'F2', onSelect: () => setEditing({ mode: 'rename', path: entry.path }) },
      { label: 'Copy path', icon: <Copy size={14} />, onSelect: () => navigator.clipboard.writeText(entry.path) },
      { label: 'Copy relative path', onSelect: () => navigator.clipboard.writeText(relative(root, entry.path)) },
      { label: 'Reveal in file manager', icon: <ExternalLink size={14} />, onSelect: () => window.strata.tools.openFolder(entry.isDir ? entry.path : dirname(entry.path)) },
      { separator: true },
      { label: 'Delete', icon: <Trash2 size={14} />, hint: 'Del', danger: true, onSelect: () => trash(entry.path) }
    )
    return items
  }

  const onDrop = async (e: React.DragEvent, dir: string): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const internal = e.dataTransfer.getData(DRAG_MIME)
    try {
      if (internal) {
        if (samePath(dirname(internal), dir) || isInside(internal, dir)) return
        const to = await window.strata.fs.move(internal, dir)
        app().renameTabPath(internal, to)
        await Promise.all([load(dirname(internal)), load(dir)])
        setSelected(to)
        return
      }
      const files = [...e.dataTransfer.files].map((f) => window.strata.fs.pathForFile(f)).filter(Boolean)
      if (files.length) {
        const copied = await window.strata.fs.copyInto(files, dir)
        await load(dir)
        if (!samePath(dir, root)) setExpanded((s) => new Set(s).add(dir))
        toast.success(`Copied ${copied.length} item${copied.length === 1 ? '' : 's'}`)
      }
    } catch (err) {
      toast.error('Drop failed', (err as Error).message)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (editing) return
    const idx = rows.findIndex((r) => r.kind === 'entry' && r.entry.path === selected)
    const row = idx >= 0 ? (rows[idx] as Extract<Row, { kind: 'entry' }>) : null
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      let n = idx + (e.key === 'ArrowDown' ? 1 : -1)
      while (rows[n] && rows[n].kind !== 'entry') n += e.key === 'ArrowDown' ? 1 : -1
      const next = rows[Math.max(0, Math.min(rows.length - 1, n))]
      if (next?.kind === 'entry') {
        setSelected(next.entry.path)
        const el = scrollRef.current
        if (el) {
          const top = Math.max(0, Math.min(rows.length - 1, n)) * ROW
          if (top < el.scrollTop) el.scrollTop = top
          else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
        }
      }
    } else if (!row) {
      return
    } else if (e.key === 'ArrowRight' && row.entry.isDir) {
      toggle(row.entry.path, true)
    } else if (e.key === 'ArrowLeft') {
      if (row.entry.isDir && expanded.has(row.entry.path)) toggle(row.entry.path, false)
      else if (!samePath(dirname(row.entry.path), root)) setSelected(dirname(row.entry.path))
    } else if (e.key === 'Enter') {
      if (row.entry.isDir) toggle(row.entry.path)
      else app().openFile(row.entry.path)
    } else if (e.key === 'F2') {
      setEditing({ mode: 'rename', path: row.entry.path })
    } else if (e.key === 'Delete') {
      trash(row.entry.path)
    }
  }

  return (
    <div className="explorer">
      <div className="panel-header">
        <span className="panel-title" title={root}>
          {project.name}
        </span>
        <div className="panel-actions">
          <button className="icon-btn icon-btn-xs" data-tip="New file" onClick={() => beginCreate('newFile', targetDirFor(selected))}>
            <FilePlus size={14} />
          </button>
          <button className="icon-btn icon-btn-xs" data-tip="New folder" onClick={() => beginCreate('newDir', targetDirFor(selected))}>
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn icon-btn-xs"
            data-tip="Refresh"
            onClick={() => {
              load(root)
              expanded.forEach((d) => load(d))
            }}
          >
            <RefreshCw size={13} />
          </button>
          <button className="icon-btn icon-btn-xs" data-tip="Collapse all" onClick={() => setExpanded(new Set())}>
            <ListCollapse size={14} />
          </button>
        </div>
      </div>
      <div
        className={`tree ${dropTarget === root ? 'is-drop-root' : ''}`}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onContextMenu={(e) => openContextMenu(e, contextItems(null))}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy'
          if (dropTarget !== root) setDropTarget(root)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
        }}
        onDrop={(e) => onDrop(e, root)}
      >
        {error && <div className="empty-hint error">{error}</div>}
        {!error && children.get(root)?.length === 0 && !editing && <div className="empty-hint">This folder is empty. Right-click to create a file.</div>}
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(startIdx, endIdx).map((r, i) => {
            const top = (startIdx + i) * ROW
            if (r.kind === 'input') {
              return (
                <div key={`input-${r.parent}`} className="tree-row is-editing" style={{ top, paddingLeft: 8 + r.depth * 12 }}>
                  <span className="tree-chevron" />
                  {r.mode === 'newDir' ? <FolderIcon name="" /> : <FileIcon name="" />}
                  <InlineInput initial="" onCommit={commitEdit} onCancel={() => setEditing(null)} />
                </div>
              )
            }
            const e = r.entry
            const key = e.path.replace(/\\/g, '/').toLowerCase()
            const letter = decorations.files.get(key)
            const dirMark = e.isDir && decorations.dirs.has(key)
            const open = e.isDir && expanded.has(e.path)
            const isEditing = editing?.mode === 'rename' && editing.path === e.path
            return (
              <div
                key={e.path}
                className={`tree-row ${selected === e.path ? 'is-selected' : ''} ${dropTarget === e.path ? 'is-drop' : ''} ${letter ? 'git-' + letter : ''} ${dirMark ? 'has-changes' : ''} ${
                  e.name.startsWith('.') || e.name === 'node_modules' ? 'is-dim' : ''
                }`}
                style={{ top, paddingLeft: 8 + r.depth * 12 }}
                draggable={!isEditing}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(DRAG_MIME, e.path)
                  ev.dataTransfer.setData('text/plain', `@${relative(root, e.path)}`)
                  ev.dataTransfer.effectAllowed = 'copyMove'
                }}
                onDragOver={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  const t = e.isDir ? e.path : dirname(e.path)
                  ev.dataTransfer.dropEffect = ev.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy'
                  if (dropTarget !== t) setDropTarget(t)
                }}
                onDrop={(ev) => onDrop(ev, e.isDir ? e.path : dirname(e.path))}
                onClick={() => {
                  setSelected(e.path)
                  if (e.isDir) toggle(e.path)
                  else app().openFile(e.path, { preview: true })
                }}
                onDoubleClick={() => !e.isDir && app().openFile(e.path)}
                onContextMenu={(ev) => {
                  setSelected(e.path)
                  openContextMenu(ev, contextItems(e))
                }}
                title={relative(root, e.path)}
              >
                {r.depth > 0 && <span className="tree-guides" style={{ width: r.depth * 12 }} />}
                <span className={`tree-chevron ${open ? 'is-open' : ''}`}>{e.isDir && <ChevronRight size={13} />}</span>
                {e.isDir ? <FolderIcon name={e.name} open={open} /> : <FileIcon name={e.name} />}
                {isEditing ? (
                  <InlineInput initial={e.name} selectStem={!e.isDir} onCommit={commitEdit} onCancel={() => setEditing(null)} />
                ) : (
                  <span className="tree-name">{e.name}</span>
                )}
                {letter && <span className="tree-badge">{letter}</span>}
                {dirMark && !letter && <span className="tree-dot" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InlineInput({ initial, onCommit, onCancel, selectStem }: { initial: string; onCommit(v: string): void; onCancel(): void; selectStem?: boolean }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    if (selectStem && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [])
  return (
    <input
      ref={ref}
      className="tree-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          done.current = true
          onCommit(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          done.current = true
          onCancel()
        }
      }}
      onBlur={(e) => {
        if (!done.current) onCommit(e.currentTarget.value)
      }}
    />
  )
}

export async function openBlender(file?: string): Promise<void> {
  const r = await window.strata.tools.openBlender(file)
  if (!r.ok) toast.error('Could not open Blender', r.error)
  else toast.success('Opening Blender…')
}

export async function openRoblox(file?: string): Promise<void> {
  const r = await window.strata.tools.openRobloxStudio(file)
  if (!r.ok) toast.error('Could not open Roblox Studio', r.error)
  else toast.success('Opening Roblox Studio…')
}
