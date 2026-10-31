import { ExternalLink, RefreshCw, SquareTerminal } from 'lucide-react'
import { useRef, useState } from 'react'
import { activeProject, useApp } from '@/store/app'
import { useChat } from '@/store/chat'
import { useTerminals } from '@/store/terminals'
import { Button } from './ui/Button'
import { Popover } from './ui/Popover'

export type ClaudeState = 'missing' | 'auth' | 'busy' | 'ready' | 'checking'

export function useClaudeState(): ClaudeState {
  const tools = useApp((s) => s.tools)
  const project = useApp(activeProject)
  const busy = useChat((s) => (project ? !!s.chats[project.id]?.busy : false))
  const authFlag = useChat((s) => (project ? !!s.chats[project.id]?.authRequired : false))
  if (!tools) return 'checking'
  if (!tools.tools.claude.found) return 'missing'
  if (busy) return 'busy'
  if (authFlag || tools.claudeAuth.loggedIn === false) return 'auth'
  return 'ready'
}

const LABEL: Record<ClaudeState, string> = {
  missing: 'Not found',
  auth: 'Sign in required',
  busy: 'Working',
  ready: 'Connected',
  checking: 'Checking…'
}

/** Opens a terminal tab running `claude` in the project so the user can /login. */
export function openClaudeInTerminal(): void {
  const app = useApp.getState()
  const project = activeProject(app)
  if (!project) {
    app.openSettings('claude')
    return
  }
  app.toggleTerminal(true)
  useTerminals.getState().requestNew(project.id, 'claude')
}

export function ClaudeStatus(): JSX.Element {
  const state = useClaudeState()
  const tools = useApp((s) => s.tools)
  const detecting = useApp((s) => s.detecting)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const claude = tools?.tools.claude
  const auth = tools?.claudeAuth

  return (
    <>
      <button ref={ref} className={`status-pill status-${state}`} onClick={() => setOpen((o) => !o)}>
        <span className="status-dot" />
        <span className="status-name">Claude</span>
        <span className="status-label">{LABEL[state]}</span>
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} align="center">
        <div className="claude-card">
          <div className="claude-card-head">
            <span className={`status-dot status-${state}`} />
            <div>
              <div className="claude-card-title">Claude Code</div>
              <div className="claude-card-sub">{claude?.found ? `v${claude.version ?? '?'}` : 'CLI not detected'}</div>
            </div>
          </div>
          <dl className="kv">
            <dt>Path</dt>
            <dd className="mono">{claude?.path ?? '—'}</dd>
            <dt>Auth</dt>
            <dd>{auth?.loggedIn ? `Signed in (${auth.method ?? 'ok'})` : auth?.loggedIn === false ? 'Not signed in' : 'Unknown'}</dd>
            {auth?.provider && (
              <>
                <dt>Provider</dt>
                <dd>{auth.provider}</dd>
              </>
            )}
          </dl>
          {state === 'auth' && <div className="callout callout-warn">Claude Code needs to be authenticated.</div>}
          {state === 'missing' && (
            <div className="callout callout-error">
              Install Claude Code (<span className="mono">npm i -g @anthropic-ai/claude-code</span>) or set its path in Settings.
            </div>
          )}
          <div className="claude-card-actions">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={detecting} onClick={() => useApp.getState().refreshTools(true)}>
              Re-detect
            </Button>
            {claude?.found && (
              <Button
                size="sm"
                variant={state === 'auth' ? 'primary' : 'secondary'}
                icon={<SquareTerminal size={13} />}
                onClick={() => {
                  setOpen(false)
                  openClaudeInTerminal()
                }}
              >
                Open Claude Code
              </Button>
            )}
            {!claude?.found && (
              <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={() => window.strata.tools.openExternal('https://docs.claude.com/en/docs/claude-code/setup')}>
                Install guide
              </Button>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
