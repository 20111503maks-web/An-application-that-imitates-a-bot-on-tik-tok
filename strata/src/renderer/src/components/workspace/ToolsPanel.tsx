import { Box, Check, ExternalLink, FolderOpen, Gamepad2, Play, RefreshCw, Sparkles, SquareTerminal, X } from 'lucide-react'
import type { Project, ToolInfo } from '@shared/types'
import { basename, relative } from '@/lib/path'
import { useApp } from '@/store/app'
import { useTerminals } from '@/store/terminals'
import { openClaudeInTerminal } from '../ClaudeStatus'
import { Button, IconButton } from '../ui/Button'
import { openBlender, openRoblox } from './FileExplorer'

function ToolLine({ t }: { t: ToolInfo }): JSX.Element {
  return (
    <div className={`tool-line ${t.found ? 'is-found' : ''}`} title={t.path ?? 'Not found'}>
      <span className="tool-line-icon">{t.found ? <Check size={12} strokeWidth={3} /> : <X size={12} />}</span>
      <span className="tool-line-name">{t.name}</span>
      <span className="tool-line-version">{t.found ? t.version ?? 'installed' : 'not found'}</span>
    </div>
  )
}

function runInTerminal(project: Project, command: string): void {
  useApp.getState().toggleTerminal(true)
  useTerminals.getState().requestNew(project.id, command)
}

export function ToolsPanel({ project }: { project: Project }): JSX.Element {
  const tools = useApp((s) => s.tools)
  const info = useApp((s) => s.infos[project.path])
  const detecting = useApp((s) => s.detecting)
  const app = useApp.getState
  const t = tools?.tools
  const isRoblox = info?.kinds.includes('roblox') || info?.kinds.includes('rojo')
  const isBlender = info?.kinds.includes('blender')

  return (
    <div className="tools-panel">
      <div className="info-card">
        <div className="info-row">
          <span className="info-key">Project</span>
          <span className="info-val">{project.name}</span>
        </div>
        <div className="info-row">
          <span className="info-key">Type</span>
          <span className="info-val">{info?.label ?? '…'}</span>
        </div>
        <div className="info-row">
          <span className="info-key">Folder</span>
          <span className="info-val mono ellipsis" title={project.path}>
            {project.path}
          </span>
        </div>
        <div className="info-actions">
          <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => window.strata.tools.openFolder(project.path)}>
            Open folder
          </Button>
          <Button size="sm" variant="ghost" icon={<SquareTerminal size={13} />} onClick={() => runInTerminal(project, '')}>
            Terminal here
          </Button>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-card-head">
          <Sparkles size={15} className="accent" />
          <span className="tool-card-title">Claude Code</span>
          <span className={`detect-badge ${t?.claude.found ? 'is-ok' : 'is-missing'}`}>{t?.claude.found ? 'Detected' : 'Not found'}</span>
        </div>
        {t?.claude.found && <div className="tool-card-sub mono">{t.claude.path}</div>}
        <div className="tool-card-actions">
          <Button size="sm" variant="secondary" icon={<SquareTerminal size={13} />} onClick={openClaudeInTerminal} disabled={!t?.claude.found}>
            Open in terminal
          </Button>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => window.strata.tools.openClaudeExternal(project.path)} disabled={!t?.claude.found}>
            External window
          </Button>
        </div>
      </div>

      <div className={`tool-card ${isBlender ? 'is-relevant' : ''}`}>
        <div className="tool-card-head">
          <Box size={15} style={{ color: '#ea7600' }} />
          <span className="tool-card-title">Blender</span>
          <span className={`detect-badge ${t?.blender.found ? 'is-ok' : 'is-missing'}`}>{t?.blender.found ? 'Detected' : 'Not found'}</span>
        </div>
        {t?.blender.found && <div className="tool-card-sub mono">{t.blender.path}</div>}
        {!!info?.blendFiles.length && (
          <div className="tool-files">
            {info.blendFiles.slice(0, 6).map((f) => (
              <button key={f} className="tool-file" onClick={() => openBlender(f)} disabled={!t?.blender.found}>
                <Play size={11} />
                {relative(project.path, f)}
              </button>
            ))}
          </div>
        )}
        <div className="tool-card-actions">
          <Button size="sm" variant="secondary" onClick={() => openBlender()} disabled={!t?.blender.found}>
            Open Blender
          </Button>
          <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => window.strata.tools.openFolder(project.path)}>
            Open project folder
          </Button>
        </div>
        {!t?.blender.found && (
          <button className="link-btn" onClick={() => app().openSettings('blender')}>
            Set Blender path…
          </button>
        )}
      </div>

      <div className={`tool-card ${isRoblox ? 'is-relevant' : ''}`}>
        <div className="tool-card-head">
          <Gamepad2 size={15} style={{ color: '#e5534b' }} />
          <span className="tool-card-title">Roblox Studio</span>
          <span className={`detect-badge ${t?.roblox.found ? 'is-ok' : 'is-missing'}`}>{t?.roblox.found ? 'Detected' : 'Not found'}</span>
        </div>
        {!!info?.placeFiles.length && (
          <div className="tool-files">
            {info.placeFiles.slice(0, 6).map((f) => (
              <button key={f} className="tool-file" onClick={() => openRoblox(f)} disabled={!t?.roblox.found}>
                <Play size={11} />
                {basename(f)}
              </button>
            ))}
          </div>
        )}
        <div className="tool-card-actions">
          <Button size="sm" variant="secondary" onClick={() => openRoblox()} disabled={!t?.roblox.found}>
            Open Roblox Studio
          </Button>
        </div>
        <div className="tool-sub-line">
          <span className={`detect-dot ${t?.rojo.found ? 'is-ok' : ''}`} />
          Rojo {t?.rojo.found ? t.rojo.version ?? '' : 'not found'}
          {t?.rojo.found && !!info?.rojoProjects.length && (
            <button className="link-btn" onClick={() => runInTerminal(project, `rojo serve "${basename(info.rojoProjects[0])}"`)}>
              Start rojo serve
            </button>
          )}
        </div>
        {!t?.roblox.found && (
          <button className="link-btn" onClick={() => app().openSettings('roblox')}>
            Set Roblox Studio path…
          </button>
        )}
      </div>

      <div className="tool-card">
        <div className="tool-card-head">
          <span className="tool-card-title">Detected tools</span>
          <div className="spacer" />
          <IconButton size="xs" tip="Re-detect" onClick={() => app().refreshTools(true)}>
            <RefreshCw size={12} className={detecting ? 'spin' : ''} />
          </IconButton>
        </div>
        <div className="tool-lines">{t && Object.values(t).map((x) => <ToolLine key={x.id} t={x} />)}</div>
      </div>
    </div>
  )
}
