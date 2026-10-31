import { ExternalLink, FolderPlus, Pin, PinOff, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { useApp } from '@/store/app'
import { useChat } from '@/store/chat'
import { tildify } from '@/lib/path'
import { ProjectGlyph } from './ProjectGlyph'
import { Resizer } from './ui/Resizer'
import { confirmDialog } from './ui/Dialog'
import { openContextMenu } from './ui/Menu'
import { newWorkspaceFlow } from './Welcome'

async function removeFlow(p: Project): Promise<void> {
  const app = useApp.getState()
  if (app.settings?.confirmRemoveProject) {
    const ok = await confirmDialog({
      title: `Remove “${p.name}” from Strata?`,
      message: 'The folder and its files stay on your computer — it is only removed from this list.',
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
  }
  await app.removeProject(p.id)
}

function ProjectRow({ p, active }: { p: Project; active: boolean }): JSX.Element {
  const info = useApp((s) => s.infos[p.path])
  const busy = useChat((s) => !!s.chats[p.id]?.busy)
  const app = useApp.getState
  return (
    <div
      className={`project-row ${active ? 'is-active' : ''}`}
      onClick={() => app().openProject(p.id)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: 'Open', onSelect: () => app().openProject(p.id) },
          { label: 'Reveal in file manager', icon: <ExternalLink size={14} />, onSelect: () => window.strata.tools.openFolder(p.path) },
          { label: 'Copy path', onSelect: () => navigator.clipboard.writeText(p.path) },
          { label: p.pinned ? 'Unpin' : 'Pin to top', icon: p.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => app().updateProject(p.id, { pinned: !p.pinned }) },
          { separator: true },
          { label: 'Remove from list', icon: <X size={14} />, danger: true, onSelect: () => removeFlow(p) }
        ])
      }
      title={p.path}
    >
      <ProjectGlyph project={p} size={26} />
      <div className="project-row-text">
        <div className="project-row-name">
          {p.name}
          {p.pinned && <Pin size={10} className="muted" />}
        </div>
        <div className="project-row-meta">{info ? info.label : tildify(p.path)}</div>
      </div>
      {busy && <span className="pulse-dot" title="Claude is working" />}
      <button
        className="project-row-remove"
        onClick={(e) => {
          e.stopPropagation()
          removeFlow(p)
        }}
        data-tip="Remove from list"
        data-tip-side="right"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const projects = useApp((s) => s.projects)
  const activeId = useApp((s) => s.activeId)
  const width = useApp((s) => s.layout.sidebarWidth)
  const [base, setBase] = useState(width)
  const app = useApp.getState

  useEffect(() => {
    for (const p of projects) if (!app().infos[p.path]) app().refreshInfo(p.path)
  }, [projects])

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="panel-header">
        <span className="panel-title">Projects</span>
        <div className="panel-actions">
          <button className="icon-btn icon-btn-xs" data-tip="New workspace" onClick={() => newWorkspaceFlow()}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="project-list">
        {projects.map((p) => (
          <ProjectRow key={p.id} p={p} active={p.id === activeId} />
        ))}
        {!projects.length && <div className="empty-hint">No projects yet. Add a folder to get started.</div>}
      </div>
      <div className="sidebar-footer">
        <button className="add-folder-btn" onClick={() => app().addFoldersDialog()}>
          <FolderPlus size={14} />
          <span>Add folder</span>
        </button>
      </div>
      <Resizer
        direction="x"
        className="sidebar-resizer"
        onStart={() => setBase(useApp.getState().layout.sidebarWidth)}
        onResize={(d) => app().setLayout({ sidebarWidth: Math.max(190, Math.min(420, base + d)) })}
      />
    </aside>
  )
}
