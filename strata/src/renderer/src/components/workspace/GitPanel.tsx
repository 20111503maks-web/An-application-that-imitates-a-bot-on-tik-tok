import { ArrowDown, ArrowUp, Check, GitBranch, Minus, Plus, RefreshCw, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GitFile, Project } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import { basename, dirname, join } from '@/lib/path'
import { useApp } from '@/store/app'
import { toast } from '@/store/toast'
import { Button, IconButton } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'

const LETTER_CLASS: Record<string, string> = { M: 'mod', A: 'add', D: 'del', R: 'ren', U: 'new', C: 'mod', '?': 'new' }

function letterOf(f: GitFile, staged: boolean): string {
  const c = staged ? f.index : f.work
  return c === '?' ? 'U' : c
}

export function GitPanel({ project }: { project: Project }): JSX.Element {
  const status = useApp((s) => s.git[project.id])
  const tools = useApp((s) => s.tools)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const app = useApp.getState
  const cwd = project.path

  useEffect(() => {
    app().refreshGit(project.id)
  }, [project.id])

  const run = async (label: string, fn: () => Promise<unknown>, success?: string): Promise<void> => {
    setBusy(label)
    try {
      const out = await fn()
      if (success) toast.success(success, typeof out === 'string' ? out.split('\n').slice(-2).join('\n').slice(0, 200) : undefined)
    } catch (err) {
      toast.error(`${label} failed`, (err as Error).message.slice(0, 400))
    } finally {
      setBusy(null)
      app().refreshGit(project.id)
    }
  }

  if (!tools?.tools.git.found && !status?.isRepo) {
    return (
      <div className="panel-empty">
        <GitBranch size={22} />
        <div>Git is not installed</div>
        <small>Install Git for Windows to see branches and changes here.</small>
        <Button size="sm" variant="secondary" onClick={() => window.strata.tools.openExternal('https://git-scm.com/download/win')}>
          Download Git
        </Button>
      </div>
    )
  }

  if (!status) return <div className="panel-empty">Loading…</div>

  if (!status.isRepo) {
    return (
      <div className="panel-empty">
        <GitBranch size={22} />
        <div>Not a Git repository</div>
        <small>Initialize a repository to track changes in this project.</small>
        <Button size="sm" variant="secondary" loading={busy === 'Init'} onClick={() => run('Init', () => window.strata.git.init(cwd), 'Repository initialized')}>
          Initialize repository
        </Button>
      </div>
    )
  }

  const staged = status.files.filter((f) => f.index !== ' ' && f.index !== '?')
  const unstaged = status.files.filter((f) => f.work !== ' ' || f.index === '?')
  const root = status.root ?? cwd

  const row = (f: GitFile, isStaged: boolean): JSX.Element => {
    const letter = letterOf(f, isStaged)
    const abs = join(root, f.path)
    return (
      <div key={(isStaged ? 's:' : 'u:') + f.path} className="file-item" onClick={() => (letter === 'D' ? undefined : app().openDiff(abs, 'git', f.path))} title={f.path}>
        <FileIcon name={basename(f.path)} size={14} />
        <span className="file-item-name">{basename(f.path)}</span>
        {dirname(f.path) !== f.path && <span className="file-item-dir">{dirname(f.path)}</span>}
        <span className="file-item-actions">
          {!isStaged && (
            <IconButton
              size="xs"
              tip="Discard changes"
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await confirmDialog({ title: `Discard changes in ${basename(f.path)}?`, message: letter === 'U' ? 'This untracked file will be deleted.' : 'This cannot be undone.', confirmLabel: 'Discard', danger: true })
                if (ok) run('Discard', () => window.strata.git.discard(cwd, [f.path]))
              }}
            >
              <Undo2 size={13} />
            </IconButton>
          )}
          <IconButton
            size="xs"
            tip={isStaged ? 'Unstage' : 'Stage'}
            onClick={(e) => {
              e.stopPropagation()
              run(isStaged ? 'Unstage' : 'Stage', () => (isStaged ? window.strata.git.unstage(cwd, [f.path]) : window.strata.git.stage(cwd, [f.path])))
            }}
          >
            {isStaged ? <Minus size={13} /> : <Plus size={13} />}
          </IconButton>
        </span>
        <span className={`git-letter is-${LETTER_CLASS[letter] ?? 'mod'}`}>{letter}</span>
      </div>
    )
  }

  const commit = (): void => {
    if (!message.trim()) return
    const doCommit = async (): Promise<string> => {
      if (!staged.length) await window.strata.git.stage(cwd, [])
      const out = await window.strata.git.commit(cwd, message)
      setMessage('')
      return out
    }
    run('Commit', doCommit, 'Committed')
  }

  return (
    <div className="git">
      <div className="git-branch-bar">
        <GitBranch size={14} />
        <span className="git-branch">{status.branch ?? 'unknown'}</span>
        {status.upstream && (
          <span className="git-sync" title={status.upstream}>
            {status.behind > 0 && (
              <span>
                <ArrowDown size={11} />
                {status.behind}
              </span>
            )}
            {status.ahead > 0 && (
              <span>
                <ArrowUp size={11} />
                {status.ahead}
              </span>
            )}
          </span>
        )}
        <div className="spacer" />
        <IconButton size="xs" tip="Pull" onClick={() => run('Pull', () => window.strata.git.pull(cwd), 'Pulled')} disabled={!!busy}>
          <ArrowDown size={13} />
        </IconButton>
        <IconButton size="xs" tip="Push" onClick={() => run('Push', () => window.strata.git.push(cwd), 'Pushed')} disabled={!!busy}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton size="xs" tip="Refresh" onClick={() => app().refreshGit(project.id)}>
          <RefreshCw size={12} className={busy ? 'spin' : ''} />
        </IconButton>
      </div>

      <div className="commit-box">
        <textarea
          className="input commit-input"
          placeholder={`Commit message (${staged.length ? 'staged' : 'all'} changes)`}
          value={message}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
          }}
        />
        <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={!message.trim() || !status.files.length} loading={busy === 'Commit'} onClick={commit}>
          Commit{staged.length ? '' : ' all'}
        </Button>
      </div>

      {status.error && <div className="callout callout-error">{status.error}</div>}

      <div className="git-lists">
        {staged.length > 0 && (
          <div className="git-section">
            <div className="git-section-head">
              <span>Staged</span>
              <span className="count">{staged.length}</span>
              <div className="spacer" />
              <IconButton size="xs" tip="Unstage all" onClick={() => run('Unstage', () => window.strata.git.unstage(cwd, []))}>
                <Minus size={13} />
              </IconButton>
            </div>
            {staged.map((f) => row(f, true))}
          </div>
        )}
        <div className="git-section">
          <div className="git-section-head">
            <span>Changes</span>
            <span className="count">{unstaged.length}</span>
            <div className="spacer" />
            {unstaged.length > 0 && (
              <IconButton size="xs" tip="Stage all" onClick={() => run('Stage', () => window.strata.git.stage(cwd, []))}>
                <Plus size={13} />
              </IconButton>
            )}
          </div>
          {unstaged.map((f) => row(f, false))}
          {!unstaged.length && !staged.length && <div className="empty-hint">Working tree clean</div>}
        </div>
      </div>
    </div>
  )
}
