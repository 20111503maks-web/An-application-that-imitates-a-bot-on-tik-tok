import { FileDiff, Files, GitBranch, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { Project } from '@shared/types'
import { useApp, type RightTab } from '@/store/app'
import { useChat } from '@/store/chat'
import { Resizer } from '../ui/Resizer'
import { ChangesPanel } from './ChangesPanel'
import { FileExplorer } from './FileExplorer'
import { GitPanel } from './GitPanel'
import { ToolsPanel } from './ToolsPanel'

export function RightPanel({ project }: { project: Project }): JSX.Element {
  const tab = useApp((s) => s.rightTab)
  const width = useApp((s) => s.layout.rightWidth)
  const changes = useChat((s) => s.chats[project.id]?.changes.length ?? 0)
  const gitCount = useApp((s) => s.git[project.id]?.files.length ?? 0)
  const isRepo = useApp((s) => s.git[project.id]?.isRepo)
  const [base, setBase] = useState(width)
  const app = useApp.getState

  const tabs: { id: RightTab; label: string; icon: JSX.Element; count?: number }[] = [
    { id: 'files', label: 'Files', icon: <Files size={14} /> },
    { id: 'changes', label: 'Changes', icon: <FileDiff size={14} />, count: changes },
    { id: 'git', label: 'Git', icon: <GitBranch size={14} />, count: isRepo ? gitCount : undefined },
    { id: 'tools', label: 'Tools', icon: <Wrench size={14} /> }
  ]

  return (
    <aside className="right-panel" style={{ width }}>
      <Resizer
        direction="x"
        className="right-resizer"
        onStart={() => setBase(useApp.getState().layout.rightWidth)}
        onResize={(d) => app().setLayout({ rightWidth: Math.max(240, Math.min(640, base - d)) })}
      />
      <div className="segmented">
        {tabs.map((t) => (
          <button key={t.id} className={`segment ${tab === t.id ? 'is-active' : ''}`} onClick={() => app().setRightTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
            {!!t.count && <span className="segment-count">{t.count > 99 ? '99+' : t.count}</span>}
          </button>
        ))}
      </div>
      <div className="right-body">
        <div style={{ display: tab === 'files' ? 'contents' : 'none' }}>
          <FileExplorer project={project} />
        </div>
        {tab === 'changes' && <ChangesPanel project={project} />}
        {tab === 'git' && <GitPanel project={project} />}
        {tab === 'tools' && <ToolsPanel project={project} />}
      </div>
    </aside>
  )
}
