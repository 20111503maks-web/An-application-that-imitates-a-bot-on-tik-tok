import { Check, ChevronDown, Copy, FolderOpen, FolderPlus, GitBranch, Minus, PanelLeft, PanelRight, Plus, Settings, Square, SquareTerminal, Wrench, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { activeProject, useApp } from '@/store/app'
import { tildify } from '@/lib/path'
import { ClaudeStatus } from './ClaudeStatus'
import { Logo } from './Logo'
import { IconButton } from './ui/Button'
import { Popover } from './ui/Popover'
import { ProjectGlyph } from './ProjectGlyph'
import { newWorkspaceFlow } from './Welcome'

function ProjectSwitcher(): JSX.Element {
  const project = useApp(activeProject)
  const projects = useApp((s) => s.projects)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const app = useApp.getState
  return (
    <>
      <button ref={ref} className={`project-switcher ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        {project ? <ProjectGlyph project={project} size={18} /> : null}
        <span className="project-switcher-name">{project?.name ?? 'No project'}</span>
        <ChevronDown size={13} className="muted" />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} className="switcher-pop">
        <div className="menu">
          <div className="menu-heading">Projects</div>
          <div className="switcher-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`menu-item ${p.id === project?.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setOpen(false)
                  app().openProject(p.id)
                }}
              >
                <span className="menu-icon">
                  <ProjectGlyph project={p} size={18} />
                </span>
                <span className="menu-label">
                  {p.name}
                  <span className="menu-desc mono">{tildify(p.path)}</span>
                </span>
                <span className="menu-check">{p.id === project?.id && <Check size={13} />}</span>
              </button>
            ))}
            {!projects.length && <div className="menu-empty">No projects yet</div>}
          </div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (setOpen(false), app().openFolderDialog())}>
            <span className="menu-icon">
              <FolderOpen size={14} />
            </span>
            <span className="menu-label">Open folder…</span>
            <span className="menu-hint">Ctrl O</span>
          </button>
          <button className="menu-item" onClick={() => (setOpen(false), app().addFoldersDialog())}>
            <span className="menu-icon">
              <FolderPlus size={14} />
            </span>
            <span className="menu-label">Add existing folders…</span>
          </button>
          <button className="menu-item" onClick={() => (setOpen(false), newWorkspaceFlow())}>
            <span className="menu-icon">
              <Plus size={14} />
            </span>
            <span className="menu-label">New workspace…</span>
          </button>
        </div>
      </Popover>
    </>
  )
}

function WindowControls(): JSX.Element | null {
  const [max, setMax] = useState(false)
  useEffect(() => {
    window.strata.window.isMaximized().then(setMax)
    return window.strata.window.onMaximizedChange(setMax)
  }, [])
  if (window.strata.platform === 'darwin') return null
  return (
    <div className="window-controls">
      <button className="wc-btn" onClick={() => window.strata.window.minimize()} aria-label="Minimize">
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button className="wc-btn" onClick={() => window.strata.window.toggleMaximize()} aria-label="Maximize">
        {max ? <Copy size={12} strokeWidth={1.5} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button className="wc-btn wc-close" onClick={() => window.strata.window.close()} aria-label="Close">
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}

export function TitleBar(): JSX.Element {
  const project = useApp(activeProject)
  const terminalOpen = useApp((s) => s.terminalOpen)
  const rightTab = useApp((s) => s.rightTab)
  const layout = useApp((s) => s.layout)
  const gitChanges = useApp((s) => (project ? s.git[project.id]?.files.length ?? 0 : 0))
  const app = useApp.getState

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <Logo size={18} />
          <span className="brand-name">Strata</span>
        </div>
        <span className="titlebar-sep" />
        <ProjectSwitcher />
      </div>
      <div className="titlebar-center">
        <ClaudeStatus />
      </div>
      <div className="titlebar-right">
        {project && (
          <>
            <IconButton tip="Toggle sidebar (Ctrl B)" active={layout.sidebarOpen} onClick={() => app().setLayout({ sidebarOpen: !layout.sidebarOpen })}>
              <PanelLeft size={15} />
            </IconButton>
            <IconButton tip="Terminal (Ctrl `)" active={terminalOpen} onClick={() => app().toggleTerminal()}>
              <SquareTerminal size={15} />
            </IconButton>
            <IconButton tip="Source control" active={layout.rightOpen && rightTab === 'git'} onClick={() => app().setRightTab('git')} className="with-badge">
              <GitBranch size={15} />
              {gitChanges > 0 && <span className="badge-dot">{gitChanges > 99 ? '99+' : gitChanges}</span>}
            </IconButton>
            <IconButton tip="Tools" active={layout.rightOpen && rightTab === 'tools'} onClick={() => app().setRightTab('tools')}>
              <Wrench size={15} />
            </IconButton>
            <IconButton tip="Toggle workspace panel (Ctrl Shift B)" active={layout.rightOpen} onClick={() => app().setLayout({ rightOpen: !layout.rightOpen })}>
              <PanelRight size={15} />
            </IconButton>
          </>
        )}
        <IconButton tip="Settings (Ctrl ,)" onClick={() => app().openSettings('general')}>
          <Settings size={15} />
        </IconButton>
        <WindowControls />
      </div>
    </header>
  )
}
