import { ArrowRight, Box, FolderOpen, FolderPlus, Gamepad2, Plus, Settings, Sparkles } from 'lucide-react'
import { useApp } from '@/store/app'
import { tildify } from '@/lib/path'
import { toast } from '@/store/toast'
import { Logo } from './Logo'
import { ProjectGlyph } from './ProjectGlyph'
import { promptDialog } from './ui/Dialog'

export async function newWorkspaceFlow(): Promise<void> {
  const parent = await window.strata.projects.pickParentFolder()
  if (!parent) return
  const name = await promptDialog({ title: 'New workspace', message: <>Creates a new folder inside <span className="mono">{tildify(parent)}</span></>, placeholder: 'my-project', confirmLabel: 'Create' })
  if (!name) return
  try {
    await useApp.getState().createWorkspace(parent, name)
  } catch (err) {
    toast.error('Could not create workspace', (err as Error).message)
  }
}

export function Welcome(): JSX.Element {
  const projects = useApp((s) => s.projects)
  const tools = useApp((s) => s.tools)
  const app = useApp.getState

  const toolList = tools ? (['claude', 'git', 'blender', 'roblox', 'rojo'] as const).map((id) => tools.tools[id]) : []

  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Logo size={44} />
        </div>
        <h1 className="welcome-title">Welcome to Strata</h1>
        <p className="welcome-sub">Your workspace for AI-powered development.</p>

        <div className="welcome-actions">
          <button className="welcome-action is-primary" onClick={() => app().openFolderDialog()}>
            <FolderOpen size={18} />
            <span>
              <strong>Open Project</strong>
              <small>Pick any folder — Claude Code works inside it</small>
            </span>
            <kbd className="kbd">Ctrl O</kbd>
          </button>
          <button className="welcome-action" onClick={() => app().addFoldersDialog()}>
            <FolderPlus size={18} />
            <span>
              <strong>Add Existing Folder</strong>
              <small>Add one or more folders to your project list</small>
            </span>
          </button>
          <button className="welcome-action" onClick={() => newWorkspaceFlow()}>
            <Plus size={18} />
            <span>
              <strong>New Workspace</strong>
              <small>Create a fresh, empty project folder</small>
            </span>
          </button>
          <button className="welcome-action" onClick={() => app().openSettings('general')}>
            <Settings size={18} />
            <span>
              <strong>Settings</strong>
              <small>Claude Code path, terminal, editor, theme</small>
            </span>
          </button>
        </div>

        {projects.length > 0 && (
          <div className="welcome-recent">
            <div className="section-label">Recent</div>
            {projects.slice(0, 6).map((p) => (
              <button key={p.id} className="recent-row" onClick={() => app().openProject(p.id)}>
                <ProjectGlyph project={p} size={22} />
                <span className="recent-name">{p.name}</span>
                <span className="recent-path mono">{tildify(p.path)}</span>
                <ArrowRight size={14} className="recent-arrow" />
              </button>
            ))}
          </div>
        )}

        <div className="welcome-tools">
          {toolList.map((t) => (
            <span key={t.id} className={`tool-chip ${t.found ? 'is-found' : ''}`} title={t.path ?? 'Not found'}>
              {t.id === 'claude' ? <Sparkles size={12} /> : t.id === 'blender' ? <Box size={12} /> : t.id === 'roblox' ? <Gamepad2 size={12} /> : null}
              {t.name}
              <span className="tool-chip-state">{t.found ? '✓' : '—'}</span>
            </span>
          ))}
          {!tools && <span className="tool-chip">Detecting tools…</span>}
        </div>
      </div>
    </div>
  )
}
