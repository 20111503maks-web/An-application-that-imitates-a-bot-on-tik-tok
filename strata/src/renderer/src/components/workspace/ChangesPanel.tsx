import { Check, FileDiff, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import type { Project } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import { basename, dirname, relative } from '@/lib/path'
import { useApp } from '@/store/app'
import { useChat } from '@/store/chat'
import { Button, IconButton } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'

/** Files Claude changed that are waiting for the user's Accept / Reject. */
export function ChangesPanel({ project }: { project: Project }): JSX.Element {
  const changes = useChat((s) => s.chats[project.id]?.changes ?? [])
  const { accept, reject, refreshChanges } = useChat.getState()
  const app = useApp.getState

  useEffect(() => {
    refreshChanges(project.id)
  }, [project.id])

  const totals = changes.reduce((a, c) => ({ add: a.add + c.additions, del: a.del + c.deletions }), { add: 0, del: 0 })

  const rejectAll = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Reject all changes?',
      message: `Restores ${changes.length} file${changes.length === 1 ? '' : 's'} to how they were before Claude edited them.`,
      confirmLabel: 'Reject all',
      danger: true
    })
    if (ok) reject(project.id)
  }

  return (
    <div className="changes">
      <div className="panel-header">
        <span className="panel-title">Claude changes</span>
        {changes.length > 0 && (
          <span className="diffstat">
            <span className="add">+{totals.add}</span>
            <span className="del">−{totals.del}</span>
          </span>
        )}
      </div>
      {changes.length === 0 ? (
        <div className="panel-empty">
          <FileDiff size={22} />
          <div>No pending changes</div>
          <small>When Claude edits files, they appear here for review. Accept keeps a change, Reject restores the original.</small>
        </div>
      ) : (
        <>
          <div className="changes-actions">
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={rejectAll}>
              Reject all
            </Button>
            <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => accept(project.id)}>
              Accept all
            </Button>
          </div>
          <div className="file-list">
            {changes.map((c) => {
              const rel = relative(project.path, c.path)
              const dir = dirname(rel)
              return (
                <div key={c.path} className="file-item" onClick={() => app().openDiff(c.path, 'claude')} title={rel}>
                  <FileIcon name={basename(c.path)} size={14} />
                  <span className="file-item-name">{basename(c.path)}</span>
                  {dir !== rel && <span className="file-item-dir">{dir}</span>}
                  <span className="file-item-tag">{c.original === null ? 'new' : c.deleted ? 'deleted' : ''}</span>
                  <span className="diffstat">
                    <span className="add">+{c.additions}</span>
                    <span className="del">−{c.deletions}</span>
                  </span>
                  <span className="file-item-actions">
                    <IconButton size="xs" tip="Reject" onClick={(e) => (e.stopPropagation(), reject(project.id, [c.path]))}>
                      <Undo2 size={13} />
                    </IconButton>
                    <IconButton size="xs" tip="Accept" onClick={(e) => (e.stopPropagation(), accept(project.id, [c.path]))}>
                      <Check size={13} />
                    </IconButton>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
