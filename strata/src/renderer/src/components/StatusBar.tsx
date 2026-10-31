import { ArrowDown, ArrowUp, FileDiff, GitBranch, ShieldCheck, SquareTerminal } from 'lucide-react'
import { activeProject, useApp } from '@/store/app'
import { activityOf, useChat } from '@/store/chat'

const MODE_LABEL = { ask: 'Ask first', acceptEdits: 'Accept edits', plan: 'Plan mode', bypassPermissions: 'Bypass permissions' } as const

export function StatusBar(): JSX.Element {
  const project = useApp(activeProject)
  const git = useApp((s) => (project ? s.git[project.id] : undefined))
  const info = useApp((s) => (project ? s.infos[project.path] : undefined))
  const tools = useApp((s) => s.tools)
  const settings = useApp((s) => s.settings)
  const chat = useChat((s) => (project ? s.chats[project.id] : undefined))
  const activity = chat ? activityOf(chat) : null
  const mode = chat?.mode ?? settings?.permissionMode ?? 'acceptEdits'
  const app = useApp.getState

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {project && git?.isRepo && (
          <button className="sb-item" onClick={() => app().setRightTab('git')}>
            <GitBranch size={12} />
            {git.branch}
            {git.files.length > 0 && <span className="sb-muted">· {git.files.length}</span>}
            {git.ahead > 0 && (
              <span className="sb-muted">
                <ArrowUp size={10} />
                {git.ahead}
              </span>
            )}
            {git.behind > 0 && (
              <span className="sb-muted">
                <ArrowDown size={10} />
                {git.behind}
              </span>
            )}
          </button>
        )}
        {project && !!chat?.changes.length && (
          <button className="sb-item sb-accent" onClick={() => app().setRightTab('changes')}>
            <FileDiff size={12} />
            {chat.changes.length} to review
          </button>
        )}
        {info && <span className="sb-item sb-static">{info.label}</span>}
      </div>
      <div className="statusbar-center">
        {activity && (
          <span className={`sb-activity tone-${activity.tone}`}>
            <span className="activity-dot" />
            {activity.label}
          </span>
        )}
      </div>
      <div className="statusbar-right">
        {project && (
          <button className="sb-item" onClick={() => app().toggleTerminal()}>
            <SquareTerminal size={12} />
            Terminal
          </button>
        )}
        {project && (
          <span className={`sb-item sb-static mode-${mode}`}>
            <ShieldCheck size={12} />
            {MODE_LABEL[mode]}
          </span>
        )}
        {tools?.tools.claude.found && <span className="sb-item sb-static">Claude Code {tools.tools.claude.version}</span>}
      </div>
    </footer>
  )
}
