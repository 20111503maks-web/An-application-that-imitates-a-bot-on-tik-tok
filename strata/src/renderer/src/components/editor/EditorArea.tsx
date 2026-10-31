import { Sparkles, X } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { Project } from '@shared/types'
import { FileIcon } from '@/lib/fileIcons'
import { relative } from '@/lib/path'
import { useActiveTabs, useApp, type EditorTab } from '@/store/app'
import { activityOf, useChat } from '@/store/chat'
import { ChatView } from '../chat/ChatView'
import { confirmDialog } from '../ui/Dialog'
import { openContextMenu } from '../ui/Menu'

const CodeEditor = lazy(() => import('./MonacoViews').then((m) => ({ default: m.CodeEditor })))
const DiffView = lazy(() => import('./MonacoViews').then((m) => ({ default: m.DiffView })))

async function closeWithConfirm(tab: EditorTab): Promise<void> {
  if (tab.dirty) {
    const ok = await confirmDialog({ title: `Close ${tab.title} without saving?`, message: 'Your unsaved changes will be lost.', confirmLabel: 'Discard changes', danger: true })
    if (!ok) return
  }
  useApp.getState().closeTab(tab.id)
}

function ClaudeTab({ project, active }: { project: Project; active: boolean }): JSX.Element {
  const chat = useChat((s) => s.chats[project.id])
  const activity = chat ? activityOf(chat) : null
  const pendingPerm = chat?.items.some((i) => i.type === 'permission' && i.state === 'pending')
  return (
    <button className={`tab tab-claude ${active ? 'is-active' : ''}`} onClick={() => useApp.getState().setActiveTab('chat')}>
      <Sparkles size={13} className="accent" />
      <span>Claude Code</span>
      {activity && <span className={`tab-activity ${pendingPerm ? 'is-wait' : ''}`} title={activity.label} />}
    </button>
  )
}

export function EditorArea({ project }: { project: Project }): JSX.Element {
  const { tabs, active } = useActiveTabs()
  const app = useApp.getState
  const activeTab = tabs.find((t) => t.id === active)

  return (
    <div className="editor-area">
      <div className="tabbar">
        <ClaudeTab project={project} active={active === 'chat'} />
        <div className="tabbar-scroll">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab ${t.id === active ? 'is-active' : ''} ${t.preview ? 'is-preview' : ''} ${t.kind === 'diff' ? 'is-diff' : ''}`}
              onClick={() => app().setActiveTab(t.id)}
              onDoubleClick={() => t.preview && app().openFile(t.path)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closeWithConfirm(t)
                }
              }}
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: 'Close', onSelect: () => closeWithConfirm(t) },
                  { label: 'Close others', onSelect: () => tabs.filter((x) => x.id !== t.id && !x.dirty).forEach((x) => app().closeTab(x.id)) },
                  { separator: true },
                  { label: 'Reveal in explorer', onSelect: () => app().reveal(t.path) },
                  { label: 'Copy path', onSelect: () => navigator.clipboard.writeText(t.path) },
                  { label: 'Ask Claude about this file', onSelect: () => app().insertIntoComposer(`@${relative(project.path, t.path)} `) }
                ])
              }
              title={t.path}
            >
              <FileIcon name={t.title} size={13} />
              <span className="tab-title">
                {t.title}
                {t.kind === 'diff' && <span className="tab-diff-tag">{t.diffSource === 'claude' ? 'Review' : 'Diff'}</span>}
              </span>
              <button
                className={`tab-close ${t.dirty ? 'is-dirty' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeWithConfirm(t)
                }}
              >
                <span className="dirty-dot" />
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="editor-body">
        <ChatView project={project} visible={active === 'chat'} />
        {activeTab && (
          <Suspense fallback={<div className="editor-loading"><span className="spinner" /></div>}>
            {activeTab.kind === 'file' ? <CodeEditor key={activeTab.id} project={project} tab={activeTab} /> : <DiffView key={activeTab.id} project={project} tab={activeTab} />}
          </Suspense>
        )}
      </div>
    </div>
  )
}
